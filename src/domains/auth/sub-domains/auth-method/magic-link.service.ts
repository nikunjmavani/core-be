import { createHash, randomBytes } from 'node:crypto';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { assertUserAccountActive } from '@/shared/utils/auth/account-status.util.js';
import { enforceMinimumDuration } from '@/shared/utils/security/anti-enumeration.util.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import type { MagicLinkSendResult } from '@/domains/auth/auth.types.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import type { VerificationTokenRepository } from './verification-token/verification-token.repository.js';
import { eventBus } from '@/core/events/event-bus.js';
import { validateMagicLinkSend, validateMagicLinkVerify } from '@/domains/auth/auth.validator.js';
import {
  AUTH_EVENT,
  type MagicLinkEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import {
  completeFirstFactorAuth,
  type FirstFactorAuthResult,
} from '@/domains/auth/shared/complete-first-factor-auth.js';

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
 * - User suspended/locked between issue and verify → 401 `errors:accountNotActive`.
 *
 * Side effects:
 * - `send` invalidates prior MAGIC_LINK tokens for the user (single live link),
 *   emits a domain event whose handler enqueues an outbound email via
 *   the mail outbox (`transactional-outbox` pattern).
 * - `verify` writes a single `auth_sessions` row.
 *
 * Notes: raw tokens never flow back to HTTP callers — the only egress is
 * through the email handler. Tests capture them via the event bus helper.
 */
export class MagicLinkService {
  constructor(
    private readonly userService: UserService,
    private readonly verificationTokenRepository: VerificationTokenRepository,
    private readonly organizationSettingsService: OrganizationSettingsService,
    private readonly mfaService: MfaService,
    private readonly authSessionService: AuthSessionService,
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
    const startedAtMillis = Date.now();
    const parsed = validateMagicLinkSend(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }
    // Both the known- and unknown-account branches issue the same response body; hold them to
    // a common minimum duration so the extra token-issuing writes on the known path do not
    // leak account existence through response latency.
    await this.issueMagicLinkIfUserExists(parsed.email);
    await enforceMinimumDuration(startedAtMillis);
    return {
      messageKey: 'success:magicLinkEmailSent',
      expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
    };
  }

  /**
   * Issues a magic-link token for `email` only when it maps to an existing user; a no-op
   * otherwise. Returns nothing — the caller builds the uniform (account-existence-hiding)
   * response so a known and unknown account are indistinguishable to the client.
   */
  private async issueMagicLinkIfUserExists(email: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      return;
    }
    await this.verificationTokenRepository.invalidateAllForUser(user.id, 'MAGIC_LINK');

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

    await eventBus.emitStrict({
      type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
      payload: {
        email: user.email,
        magic_link_token: rawToken,
        expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
      } satisfies MagicLinkEmailPayload,
      timestamp: new Date(),
    });
  }

  /** Verify magic link token; returns MFA challenge or access token + session. */
  async verify(
    body: unknown,
    ipAddress: string,
    userAgent?: string,
  ): Promise<FirstFactorAuthResult> {
    const parsed = validateMagicLinkVerify(body);
    const tokenHash = createHash('sha256').update(parsed.token).digest('hex');
    /** Atomic UPDATE prevents two concurrent verifies from both producing a session. */
    const record = await this.verificationTokenRepository.consumeIfValid(tokenHash);
    if (!record || record.token_type !== 'MAGIC_LINK') {
      throw new UnauthorizedError('errors:invalidOrExpiredMagicLink');
    }
    const user = await this.userService.findById(record.user_id);
    if (!user) throw new UnauthorizedError('errors:userNotFound');
    // sec-U1: pass the row so the assertion rejects soft-deleted users (the resolver
    // also filters `deleted_at IS NULL`, so the user would already be null; this is
    // belt-and-suspenders against a regression in either layer).
    assertUserAccountActive({ status: user.status, deleted_at: user.deleted_at });

    return completeFirstFactorAuth({
      user: {
        id: user.id,
        public_id: user.public_id,
        email: user.email,
        status: user.status,
        is_email_verified: user.is_email_verified,
        is_mfa_enabled: user.is_mfa_enabled,
      },
      ipAddress,
      userAgent,
      organizationSettingsService: this.organizationSettingsService,
      mfaService: this.mfaService,
      authSessionService: this.authSessionService,
    });
  }
}
