import { createHash } from 'node:crypto';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import type { Redis } from 'ioredis';
import { assertUserAccountActive } from '@/shared/utils/auth/account-status.util.js';
import { enforceMinimumDuration } from '@/shared/utils/security/anti-enumeration.util.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { isPostgresUniqueViolation } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { incrementWithExpiryOnFirst } from '@/shared/utils/infrastructure/redis-counter.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { env } from '@/shared/config/env.config.js';
import { provisionPersonalOrganization } from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import {
  EMAIL_OTP_MAX_VERIFY_ATTEMPTS,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  generateEmailOtp,
  hashEmailOtp,
} from '@/domains/auth/sub-domains/auth-method/email-otp.js';
import type { MagicLinkSendResult } from '@/domains/auth/auth.types.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { UserAuthRecord } from '@/domains/user/user.types.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import type { VerificationTokenRepository } from './verification-token/verification-token.repository.js';
import { eventBus } from '@/core/events/event-bus.js';
import { withTransaction } from '@/infrastructure/database/transaction.js';
import {
  runWithPinnedDatabaseHandle,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { validateMagicLinkSend, validateMagicLinkVerify } from '@/domains/auth/auth.validator.js';
import {
  AUTH_EVENT,
  type MagicLinkEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import {
  completeFirstFactorAuth,
  type FirstFactorAuthResult,
} from '@/domains/auth/shared/complete-first-factor-auth.js';
import {
  MAGIC_LINK_EXPIRES_IN_MINUTES,
  MILLISECONDS_PER_MINUTE,
} from '@/shared/constants/ttl.constants.js';

/** Redis key prefix for the per-user magic-link OTP attempt counter (brute-force cap). */
const MAGIC_LINK_OTP_VERIFY_ATTEMPT_KEY_PREFIX = 'auth:magic_link_otp_verify_attempts:';

/** Redis key prefix for the per-email magic-link send cooldown (anti-mail-bomb spacing). */
const MAGIC_LINK_SEND_COOLDOWN_KEY_PREFIX = 'auth:magic_link_send_cooldown:';

/**
 * Issues and verifies one-shot magic-link sign-in **codes** (6-digit OTPs) for the passwordless
 * login + auto-signup flow.
 *
 * @remarks
 * Algorithm:
 * - {@link MagicLinkService.send} validates the email and blocks disposable domains, then
 *   find-or-creates the user: an unknown email is auto-signed-up (a passwordless user + a
 *   `MAGIC_LINK` auth-method, mirroring OAuth find-or-create). Existing and new users then follow
 *   an identical path — invalidate prior MAGIC_LINK codes, persist `sha256(code)` with a 15-min
 *   expiry, and emit `AUTH_EVENT.MAGIC_LINK_REQUESTED` with the raw code in the payload.
 * - {@link MagicLinkService.verify} resolves the user by email, applies a per-user attempt cap
 *   (the code is only 6 digits, so guessing is gated by this online cap + the short TTL +
 *   single-use consume), atomically consumes the code scoped to `(user_id, MAGIC_LINK)`
 *   (`UPDATE ... RETURNING` so two concurrent verifies cannot both produce a session), flips
 *   `is_email_verified` (the code proves email control), and mints a JWT + session.
 *
 * Failure modes:
 * - Disposable email → 400 `errors:disposableEmail` from `send`.
 * - Unknown email on `verify`, wrong/expired/used code, or attempt cap exceeded → 401
 *   `errors:invalidOrExpiredMagicLink`.
 * - User soft-deleted between issue and verify → 401 `errors:userNotFound` (resolver returns null).
 * - User suspended/locked between issue and verify → 401 `errors:accountNotActive`.
 *
 * Side effects:
 * - `send` may create a user + `MAGIC_LINK` auth-method (auto-signup) and best-effort provision the
 *   personal organization; it invalidates prior MAGIC_LINK codes (single live code), and emits a
 *   domain event whose handler enqueues the code email via the mail outbox.
 * - `verify` writes a single `auth_sessions` row and may flip `users.is_email_verified`.
 *
 * Notes: raw codes never flow back to HTTP callers — the only egress is through the email handler.
 * Tests capture them via the event bus helper (`captureNextMagicLinkCode`). `send` returns the same
 * response body for new and existing accounts and holds both to a common minimum duration, so
 * neither the body nor the latency reveals whether the account pre-existed.
 */
export class MagicLinkService {
  constructor(
    private readonly userService: UserService,
    private readonly verificationTokenRepository: VerificationTokenRepository,
    private readonly organizationSettingsService: OrganizationSettingsService,
    private readonly mfaService: MfaService,
    private readonly authSessionService: AuthSessionService,
    private readonly authMethodService: AuthMethodService,
    private readonly redis: Redis = redisConnection,
  ) {}

  /**
   * Find-or-create the user, then email them a one-time sign-in code.
   *
   * The raw code is never returned to the caller in any environment — it leaves the service only
   * through the `AUTH_EVENT.MAGIC_LINK_REQUESTED` event payload (consumed by the mail handler).
   * Tests capture the code by subscribing to that event via `captureNextMagicLinkCode` in
   * `src/tests/helpers/magic-link.helper.ts`.
   */
  async send(body: unknown, _context?: { requestId?: string }): Promise<MagicLinkSendResult> {
    const startedAtMillis = Date.now();
    const parsed = validateMagicLinkSend(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }
    // Anti-mail-bomb spacing: atomically claim a per-email cooldown slot BEFORE any find-or-create.
    // If one is already held (a code was sent within EMAIL_OTP_RESEND_COOLDOWN_SECONDS), skip the
    // auto-signup + issue + email entirely and fall through to the SAME uniform success. The slot is
    // keyed on the requested email regardless of account existence, so it is never an existence
    // oracle, and the constant-time floor below still applies on both paths.
    const cooldownKey = `${MAGIC_LINK_SEND_COOLDOWN_KEY_PREFIX}${createHash('sha256')
      .update(parsed.email)
      .digest('hex')}`;
    const cooldownClaimed = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (cooldownClaimed) {
      // Auto-signup: an unknown email creates a new passwordless user (mirrors OAuth find-or-create).
      // New and existing users then run the identical issue-code path, so the response body cannot
      // reveal which case occurred; enforceMinimumDuration below masks the create-vs-existing latency
      // difference so timing is not an account-existence oracle either.
      const user =
        (await this.userService.findByEmail(parsed.email)) ??
        (await this.createMagicLinkUser(parsed.email));
      await this.issueMagicLinkOtp(user);
    }
    await enforceMinimumDuration(startedAtMillis);
    return {
      messageKey: 'success:magicLinkEmailSent',
      expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
    };
  }

  /**
   * Auto-signs-up a brand-new passwordless user for an unknown magic-link email: inserts the user
   * and its `MAGIC_LINK` auth-method atomically, then best-effort provisions the personal org.
   *
   * @remarks
   * The user + auth-method commit together (a failed method insert rolls the user back rather than
   * leaving a credential-less orphan). On a concurrent create race (two sends for the same new
   * email), the loser hits the unique-email index, rolls back, and falls back to the now-existing
   * user so both requests converge on issuing a code — magic-link is auto-signup, so a duplicate
   * email is NOT a 409 here (unlike `POST /auth/signup`). Personal-org provisioning runs AFTER the
   * commit (it uses a separate global-admin connection that cannot see an uncommitted user) and is
   * best-effort, exactly mirroring email/password and OAuth signup.
   */
  private async createMagicLinkUser(email: string): Promise<UserAuthRecord> {
    let user: UserAuthRecord;
    try {
      user = await withTransaction((transaction) =>
        runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
          const created = await this.userService.createForMagicLink({ email });
          await this.authMethodService.createMagicLinkMethod(created.id, created.public_id);
          return created;
        }),
      );
    } catch (error) {
      // A concurrent magic-link send for the same new email won the create race; the unique-email
      // index aborted (and rolled back) this transaction. Re-fetch on a fresh connection and
      // converge on the existing user — the winner already created the auth-method + personal org.
      if (isPostgresUniqueViolation(error)) {
        const existing = await this.userService.findByEmail(email);
        if (existing) return existing;
      }
      throw error;
    }

    if (env.PERSONAL_ORGANIZATION_ENABLED) {
      try {
        await provisionPersonalOrganization(user.id);
      } catch (error) {
        logger.error(
          { err: error, userId: user.public_id },
          'magic_link.user.personal_org_provision_failed',
        );
      }
    }
    return user;
  }

  /**
   * Issues a fresh magic-link OTP for an existing user: invalidates prior MAGIC_LINK codes,
   * persists `sha256(code)`, and emits `AUTH_EVENT.MAGIC_LINK_REQUESTED` with the raw code.
   *
   * @remarks
   * audit-#11: invalidating prior codes, persisting the new code, and recording the outbound
   * mail-outbox row (done inside the MAGIC_LINK_REQUESTED handler via recordOutboxEmail) must be
   * ONE atomic unit. Otherwise a handler / Redis / process failure could invalidate the user's old
   * code AND leave a new valid code that was never delivered — stranding the user. The pinned
   * transaction makes the handler's outbox insert enrol in the same tx; queue dispatch stays
   * post-commit (the handler schedules it via scheduleCommitDispatch, backed by the outbox sweeper).
   */
  private async issueMagicLinkOtp(user: { id: number; email: string }): Promise<void> {
    const code = generateEmailOtp();
    const expiresAt = new Date(
      Date.now() + MAGIC_LINK_EXPIRES_IN_MINUTES * MILLISECONDS_PER_MINUTE,
    );

    await withTransaction((transaction) =>
      runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
        await this.verificationTokenRepository.invalidateAllForUser(user.id, 'MAGIC_LINK');
        await this.verificationTokenRepository.create(
          'MAGIC_LINK',
          user.id,
          user.email,
          hashEmailOtp(code),
          expiresAt,
        );
        await eventBus.emitStrict({
          type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
          payload: {
            email: user.email,
            otp_code: code,
            expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
          } satisfies MagicLinkEmailPayload,
          timestamp: new Date(),
        });
      }),
    );

    // A freshly issued code gets a fresh per-user verify budget: clearing the attempt counter here
    // means an attacker who burned the cap against the prior code cannot keep the legitimate owner
    // locked out — requesting a new code restores their attempts. Brute-force is unaffected (each new
    // code is an independent random target, and `send` is itself per-email + per-IP rate-limited).
    await this.redis.del(`${MAGIC_LINK_OTP_VERIFY_ATTEMPT_KEY_PREFIX}${user.id}`);
  }

  /** Verify a magic-link sign-in code; returns an MFA challenge or an access token + session. */
  async verify(
    body: unknown,
    ipAddress: string,
    userAgent?: string,
  ): Promise<FirstFactorAuthResult> {
    const parsed = validateMagicLinkVerify(body);
    const normalizedEmail = parsed.email.trim().toLowerCase();

    // The 6-digit code is low-entropy, so resolve the owner first and gate guessing with a per-user
    // attempt cap (mirrors MFA + email verification) BEFORE any DB work. An unknown email is treated
    // like a wrong code so the response is not an account-existence oracle (the route also
    // rate-limits per email + IP).
    const user = await this.userService.findByEmail(normalizedEmail);
    if (!user) throw new UnauthorizedError('errors:invalidOrExpiredMagicLink');

    const attemptKey = `${MAGIC_LINK_OTP_VERIFY_ATTEMPT_KEY_PREFIX}${user.id}`;
    const attempts = await incrementWithExpiryOnFirst(
      this.redis,
      attemptKey,
      MAGIC_LINK_EXPIRES_IN_MINUTES * 60,
    );
    if (attempts > EMAIL_OTP_MAX_VERIFY_ATTEMPTS) {
      throw new UnauthorizedError('errors:invalidOrExpiredMagicLink');
    }

    // First successful completion for an as-yet-unverified account: the email is about to be proven,
    // so this is the moment a bare invited placeholder (created without a personal org) gets claimed.
    // Captured here so the post-commit provision below can mirror signup / OAuth.
    const isFirstVerification = !user.is_email_verified;

    // audit-#12: consume the one-time code AND complete first-factor auth (session creation, or the
    // MFA-challenge decision) in ONE pinned transaction. A transient failure after consumption would
    // otherwise permanently burn a valid single-use code ("invalid or expired" on retry). The atomic
    // `consumeOtpForUser` UPDATE (scoped to user_id + MAGIC_LINK) still prevents two concurrent
    // verifies from both producing a session; on a downstream failure the pinned transaction rolls
    // the consumption (and the is_email_verified flip) back, leaving the code redeemable.
    const result = await withTransaction((transaction) =>
      runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
        // sec-r5-L2 + OTP scoping: consumeOtpForUser is bound to (user.id, MAGIC_LINK) so a code
        // from another flow or another user never matches/burns, and its atomic UPDATE prevents two
        // concurrent verifies from both producing a session.
        const record = await this.verificationTokenRepository.consumeOtpForUser(
          user.id,
          'MAGIC_LINK',
          hashEmailOtp(parsed.code),
        );
        if (!record) throw new UnauthorizedError('errors:invalidOrExpiredMagicLink');
        // sec-U1: reject soft-deleted/suspended users before minting a session (the resolver already
        // filters soft-deleted; this is belt-and-suspenders against a regression in either layer).
        assertUserAccountActive({ status: user.status, deleted_at: user.deleted_at });
        // Completing the code proves the user controls this email, so mark it verified (parity with
        // OAuth, and the natural completion of magic-link auto-signup).
        if (isFirstVerification) {
          await this.userService.updateEmailVerified(user.public_id);
        }

        return completeFirstFactorAuth({
          user: {
            id: user.id,
            public_id: user.public_id,
            email: user.email,
            status: user.status,
            is_email_verified: true,
            is_mfa_enabled: user.is_mfa_enabled,
          },
          ipAddress,
          userAgent,
          organizationSettingsService: this.organizationSettingsService,
          mfaService: this.mfaService,
          authSessionService: this.authSessionService,
        });
      }),
    );

    // Clear the attempt counter so a verified user's later legitimate flows are never pre-throttled.
    await this.redis.del(attemptKey);

    // On the first successful verification, ensure the personal organization exists — a bare invited
    // placeholder is created WITHOUT one, so a magic-link claimer would otherwise have no personal org
    // (a brand-new passwordless signup already provisioned one at send time, making this an idempotent
    // no-op for that path). Runs post-commit in a separate global-admin connection that cannot see an
    // uncommitted user — and after the code is consumed, so a wrong code can never force-provision.
    // Best-effort + idempotent (partial unique index; tool:backfill-personal-orgs recovers a miss),
    // matching signup / OAuth. The just-minted token may not yet carry the personal-org claim; the
    // next refresh picks it up.
    if (isFirstVerification && env.PERSONAL_ORGANIZATION_ENABLED) {
      try {
        await provisionPersonalOrganization(user.id);
      } catch (error) {
        logger.error(
          { err: error, userId: user.public_id },
          'magic_link.verify.personal_org_provision_failed',
        );
      }
    }

    return result;
  }
}
