import { createHash, randomBytes } from 'node:crypto';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { env } from '@/shared/config/env.config.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { MagicLinkSendResult } from '@/domains/auth/auth.types.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionRepository } from '../auth-session/auth-session.repository.js';
import type { VerificationTokenRepository } from './verification-token/verification-token.repository.js';
import { eventBus } from '@/core/events/event-bus.js';
import { validateMagicLinkSend, validateMagicLinkVerify } from '../../auth.validator.js';
import {
  AUTH_EVENT,
  type MagicLinkEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';

const MAGIC_LINK_EXPIRES_IN_MINUTES = 15;

/**
 * Issues and verifies one-shot magic-link tokens used by the signup and
 * password-less login flows.
 *
 * @remarks
 * Algorithm:
 * - {@link MagicLinkService.send} validates the email, blocks disposable
 *   domains, looks up the user. If the user does not exist the response is
 *   a silent success (anti-enumeration). Otherwise it generates a 32-byte
 *   random token, persists `sha256(token)` with a 15-min expiry, and emits
 *   `AUTH_EVENT.MAGIC_LINK_REQUESTED` with the raw token in the payload.
 * - {@link MagicLinkService.verify} hashes the incoming token, atomically
 *   consumes the verification row (`UPDATE ... RETURNING` so two concurrent
 *   verifies cannot both produce a session), looks up the user, signs a
 *   short-lived JWT, and inserts a session row with `sha256(jwt)` as
 *   `token_hash`.
 *
 * Failure modes:
 * - Disposable email → 400 `errors:disposableEmail` from `send`.
 * - Unknown email → silent success from `send` (no row, no event, no email).
 * - Token expired or already consumed → 401 `errors:invalidOrExpiredMagicLink`
 *   from `verify`.
 * - User soft-deleted between issue and verify → 401 `errors:userNotFound`.
 *
 * Side effects:
 * - `send` emits a domain event whose handler enqueues an outbound email via
 *   the mail outbox (`transactional-outbox` pattern).
 * - `verify` writes a single `auth_sessions` row.
 *
 * Notes: raw tokens never flow back to HTTP callers — the only egress is
 * through the email handler. Tests capture them via the event bus helper.
 */
export class MagicLinkService {
  constructor(
    private readonly userService: UserService,
    private readonly sessionRepository: AuthSessionRepository,
    private readonly verificationTokenRepository: VerificationTokenRepository,
  ) {}

  /**
   * Create a magic link token and dispatch it to the user via email.
   *
   * The raw token is never returned to the caller in any environment — it leaves
   * the service only through the `AUTH_EVENT.MAGIC_LINK_REQUESTED` event payload
   * (consumed by the mail handler). Tests capture the token by subscribing to
   * that event via `captureNextMagicLinkToken` in `src/tests/helpers/magic-link.helper.ts`.
   */
  async send(body: unknown, _context?: { requestId?: string }): Promise<MagicLinkSendResult> {
    const parsed = validateMagicLinkSend(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }
    const user = await this.userService.findByEmail(parsed.email);
    if (!user) {
      return {
        messageKey: 'success:magicLinkEmailSent',
        expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
      };
    }
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRES_IN_MINUTES * 60_000);

    await this.verificationTokenRepository.create(
      'MAGIC_LINK',
      user.id,
      user.email,
      tokenHash,
      expiresAt,
    );

    await eventBus.emit({
      type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
      payload: {
        email: user.email,
        magic_link_token: rawToken,
        expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
      } satisfies MagicLinkEmailPayload,
      timestamp: new Date(),
    });

    return {
      messageKey: 'success:magicLinkEmailSent',
      expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
    };
  }

  /** Verify magic link token, create session, return JWT + session_public_id. */
  async verify(
    body: unknown,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{ access_token: string; session_public_id: string }> {
    const parsed = validateMagicLinkVerify(body);
    const tokenHash = createHash('sha256').update(parsed.token).digest('hex');
    /** Atomic UPDATE prevents two concurrent verifies from both producing a session. */
    const record = await this.verificationTokenRepository.consumeIfValid(tokenHash);
    if (!record || record.token_type !== 'MAGIC_LINK') {
      throw new UnauthorizedError('errors:invalidOrExpiredMagicLink');
    }
    const user = await this.userService.findById(record.user_id);
    if (!user) throw new UnauthorizedError('errors:userNotFound');

    const sessionMaxAgeDays = env.AUTH_SESSION_MAX_AGE_DAYS;
    const expiresAt = new Date(Date.now() + sessionMaxAgeDays * 86_400_000);

    const jsonWebToken = await signAccessToken({
      userId: user.public_id,
      role: resolveAccessTokenRoleForUser({
        email: user.email,
        status: user.status,
        isEmailVerified: user.is_email_verified,
      }),
    });

    const jsonWebTokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
    const session = await this.sessionRepository.create(
      omitUndefined({
        user_id: user.id,
        token_hash: jsonWebTokenHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
      }),
    );
    return { access_token: jsonWebToken, session_public_id: session.public_id };
  }
}
