import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { enforceMinimumDuration } from '@/shared/utils/security/anti-enumeration.util.js';
import { hashPassword, verifyPassword } from '@/shared/utils/security/password.util.js';
import { eventBus } from '@/core/events/event-bus.js';
import type { UserService } from '@/domains/user/user.service.js';
import {
  AUTH_EVENT,
  type EmailVerificationEmailPayload,
  type PasswordResetEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { AUTH_METHOD_TYPE } from '@/domains/auth/sub-domains/auth-method/auth-method.constants.js';
import { withTransaction } from '@/infrastructure/database/transaction.js';
import {
  runWithPinnedDatabaseHandle,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import type { AuthMethodCreateData } from './auth-method.types.js';
import type { AuthMethodRepository } from './auth-method.repository.js';
import type { VerificationTokenRepository } from './verification-token/verification-token.repository.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import {
  validateCreateAuthMethod,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateVerifyEmail,
} from '@/domains/auth/auth.validator.js';

const PASSWORD_RESET_EXPIRES_IN_MINUTES = 60;
const EMAIL_VERIFICATION_EXPIRES_IN_HOURS = 24;

/**
 * Auth-method types that can mint a session on their own (sec-A5). Used by
 * {@link AuthMethodService.delete} to refuse revoking the user's last login surface.
 * MFA types are intentionally excluded — they are second factors and never the only
 * credential a user has.
 */
const LOGIN_CAPABLE_METHOD_TYPES = new Set<string>([
  AUTH_METHOD_TYPE.PASSWORD,
  AUTH_METHOD_TYPE.OAUTH,
  AUTH_METHOD_TYPE.MAGIC_LINK,
]);

/**
 * Owns the lifecycle of {@link auth_methods} rows and the password/email
 * verification flows that share the unified verification-token table.
 *
 * @remarks
 * - **Algorithm:** authenticated callers manage their linked auth methods
 *   (PASSWORD / OAUTH / MAGIC_LINK / MFA_TOTP) via `list` / `create` / `delete`.
 *   Password reset and email verification mint a random 32-byte token, persist
 *   its SHA-256 hash with a TTL ({@link PASSWORD_RESET_EXPIRES_IN_MINUTES} or
 *   {@link EMAIL_VERIFICATION_EXPIRES_IN_HOURS}), and atomically consume it via
 *   {@link VerificationTokenRepository.consumeIfValid} to guard against replay.
 * - **Failure modes:** disposable-email submissions throw `ValidationError`;
 *   unknown users surface `NotFoundError`; bad/expired tokens or wrong current
 *   password throw `UnauthorizedError` with i18n keys.
 * - **Side effects:** invalidates outstanding tokens before issuing new ones;
 *   emits `AUTH_EVENT.PASSWORD_RESET_REQUESTED` and `AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED`
 *   (mail enqueue happens in the auth-method event handlers); rehashes user
 *   passwords via {@link UserService.updatePassword}. A password reset revokes
 *   all of the user's sessions; an authenticated change revokes every session
 *   except the caller's current one (or all sessions when no current token is
 *   supplied) via {@link AuthSessionService}.
 * - **Notes:** the forgot-password flow always returns the same success message
 *   even when the email is unknown, to prevent account enumeration. OAuth
 *   linkage is idempotent via {@link AuthMethodService.linkOAuthProviderIfMissing}.
 */
export class AuthMethodService {
  constructor(
    private readonly userService: UserService,
    private readonly authMethodRepository: AuthMethodRepository,
    private readonly verificationTokenRepository: VerificationTokenRepository,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async list(userPublicId: string) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    // auth.auth_methods is FORCE RLS (audit #7); pin the owner context so the owner policy authorizes
    // the read for this user's own credentials.
    return withUserDatabaseContext(userPublicId, () =>
      this.authMethodRepository.listByUserId(user.id),
    );
  }

  async create(userPublicId: string, body: unknown) {
    // route-#3: the DTO restricts method_type to MAGIC_LINK — the only type that is a functional
    // credential-less row. PASSWORD/MFA_* (need a stored secret) and OAUTH (proves an external
    // identity, written only by the verified callback) are rejected at validation, so none can be
    // inserted here as non-functional phantom rows that the last-credential guard would miscount.
    const parsed = validateCreateAuthMethod(body);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    return withUserDatabaseContext(userPublicId, () =>
      this.authMethodRepository.create(
        omitUndefined({
          user_id: user.id,
          method_type: parsed.method_type,
          is_primary: parsed.is_primary,
          created_by_user_id: user.id,
        }),
      ),
    );
  }

  /**
   * Revokes a user's auth method identified by its opaque `public_id` (sec-new-B4).
   *
   * @remarks
   * sec-A5: refuses to revoke the user's LAST login-capable credential. Login-capable
   * types are `PASSWORD`, `OAUTH`, and `MAGIC_LINK` (server-issued auth methods of those
   * kinds) — MFA factors (`MFA_TOTP`, `MFA_SMS`, `MFA_EMAIL`) are second factors and
   * never grant a session on their own, so revoking the last MFA method is permitted
   * here (the org-policy guard on `MfaService.deleteMfa` covers the MFA-required-by-org
   * case — sec-A4). Without this guard, a user could revoke their only PASSWORD/OAUTH
   * and lock themselves out of every login surface — recovery requires admin intervention.
   */
  async delete(userPublicId: string, methodPublicId: string) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    await withUserDatabaseContext(userPublicId, async () => {
      const existing = await this.authMethodRepository.findByPublicIdForUser(
        methodPublicId,
        user.id,
      );
      if (!existing) throw new NotFoundError('Auth method');
      const isLoginCapable = LOGIN_CAPABLE_METHOD_TYPES.has(existing.method_type);
      // Atomic count-aware revoke: the "is another login-capable method still active?" check and
      // the revoke run in ONE statement, so two concurrent deletes cannot each see "one other left"
      // and both succeed, zeroing out the user's credentials (route-audit C1 lockout race).
      const revoked = await this.authMethodRepository.revokeUnlessLastLoginCapable(
        existing.id,
        user.id,
        [...LOGIN_CAPABLE_METHOD_TYPES],
      );
      if (!revoked) {
        // `existing` was found above, so a zero-row update means either the last-login-capable guard
        // tripped (for a login-capable method) or the row was concurrently revoked.
        if (isLoginCapable) throw new ForbiddenError('errors:cannotRemoveLastAuthMethod');
        throw new NotFoundError('Auth method');
      }

      // sec-r5-auth-session-info-1: revoking the PASSWORD auth_method row only
      // flipped `auth_methods.revoked_at` but left the stale `users.password_hash`
      // intact, so `POST /auth/login` continued to accept the old credential
      // — the user-facing "I removed my password" view did not match the
      // auth-layer view. Clear the hash atomically in the same
      // withUserDatabaseContext transaction so the invariant is real.
      if (existing.method_type === 'PASSWORD') {
        await this.userService.clearPasswordHash(userPublicId);
      }
    });
  }

  async revokeAllForUser(userPublicId: string): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    await withUserDatabaseContext(userPublicId, () =>
      this.authMethodRepository.revokeAllByUserId(user.id),
    );
  }

  /**
   * Invalidate every outstanding verification token (magic-link, password-reset, email-
   * verify, email-change) for a user. Called by the user-offboarding sequence (sec-U1)
   * so a token issued seconds before soft-delete cannot be redeemed to mint a session
   * for the deleted user.
   *
   * @remarks
   * Runs inside `withUserDatabaseContext` so the RLS-scoped UPDATE only touches rows
   * owned by the target user; the operation is idempotent (already-used or expired
   * tokens are no-ops). Safe to call at any point in the offboarding sequence — there is
   * no rollback risk because invalidation is a strict superset of natural token expiry.
   */
  async invalidateAllVerificationTokensForUser(userPublicId: string): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    await withUserDatabaseContext(userPublicId, () =>
      this.verificationTokenRepository.invalidateAllByUser(user.id),
    );
  }

  async findByProviderUserId(provider: string, provider_user_id: string) {
    return this.authMethodRepository.findByProviderUserId(provider, provider_user_id);
  }

  async linkOAuthProviderIfMissing({
    ownerPublicId,
    data,
  }: {
    ownerPublicId: string;
    data: AuthMethodCreateData;
  }): Promise<void> {
    if (!(data.provider && data.provider_user_id)) {
      return;
    }
    // findByProviderUserId goes through the SECURITY DEFINER resolver (pre-session safe); the INSERT
    // must satisfy the owner WITH CHECK, so pin the owner context for the linkage write.
    const existing = await this.authMethodRepository.findByProviderUserId(
      data.provider,
      data.provider_user_id,
    );
    if (!existing) {
      await withUserDatabaseContext(ownerPublicId, () => this.authMethodRepository.create(data));
    }
  }

  async findTotpByUserId(user_id: number) {
    return this.authMethodRepository.findTotpByUserId(user_id);
  }

  async createAuthMethodRecord(data: AuthMethodCreateData) {
    return this.authMethodRepository.create(data);
  }

  async updateAuthMethodLastUsedAt(methodId: number, userId: number): Promise<void> {
    await this.authMethodRepository.updateLastUsedAt(methodId, userId);
  }

  async findAuthMethodByIdForUser(methodId: number, userId: number) {
    return this.authMethodRepository.findByIdForUser(methodId, userId);
  }

  /** route-#10: resolves an auth method by its opaque public id (scoped to the owning user). */
  async findAuthMethodByPublicIdForUser(methodPublicId: string, userId: number) {
    return this.authMethodRepository.findByPublicIdForUser(methodPublicId, userId);
  }

  async listMfaMethodsByUserId(userId: number) {
    return this.authMethodRepository.listMfaByUserId(userId);
  }

  /**
   * Serializes concurrent credential mutations for one user via a transaction-scoped advisory lock.
   * Must be called inside the caller's `withUserDatabaseContext` transaction, before a
   * count-then-mutate, so concurrent requests cannot interleave the count and the write.
   */
  async acquireCredentialMutationLock(userId: number): Promise<void> {
    await this.authMethodRepository.acquireCredentialMutationLock(userId);
  }

  async revokeAuthMethod(methodId: number, userId: number): Promise<void> {
    const revoked = await this.authMethodRepository.revoke(methodId, userId);
    if (!revoked) throw new NotFoundError('Auth method');
  }

  // ── Password Reset ────────────────────────────────────────────

  async forgotPassword(
    body: unknown,
    _context?: { requestId?: string },
  ): Promise<{ messageKey: string; messageParams?: Record<string, string | number> }> {
    const startedAtMillis = Date.now();
    const parsed = validateForgotPassword(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }

    await this.issuePasswordResetIfUserExists(parsed.email);
    // Both branches return the same body; hold them to a common minimum duration so the extra
    // token-issuing writes on the known-account path cannot leak existence via response latency.
    await enforceMinimumDuration(startedAtMillis);
    return { messageKey: 'success:passwordResetEmailSent' };
  }

  private async issuePasswordResetIfUserExists(email: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user) return;

    // Invalidate any existing password reset tokens
    await this.verificationTokenRepository.invalidateAllForUser(user.id, 'PASSWORD_RESET');

    // Create new token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_IN_MINUTES * 60_000);

    await this.verificationTokenRepository.create(
      'PASSWORD_RESET',
      user.id,
      user.email,
      tokenHash,
      expiresAt,
    );

    await eventBus.emitStrict({
      type: AUTH_EVENT.PASSWORD_RESET_REQUESTED,
      payload: {
        email: user.email,
        reset_token: rawToken,
        expires_in_minutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
      } satisfies PasswordResetEmailPayload,
      timestamp: new Date(),
    });
  }

  async resetPassword(body: unknown): Promise<void> {
    const parsed = validateResetPassword(body);
    const tokenHash = createHash('sha256').update(parsed.token).digest('hex');

    // Hash the new password BEFORE opening the transaction: argon2 is CPU-bound (~100ms) and
    // must not hold a pooled connection open inside the transaction.
    const passwordHash = await hashPassword(parsed.password);

    // Token consume, password update, token invalidation and session revocation must be atomic.
    // A partial apply (password changed but sessions not revoked) would leave a potentially
    // compromised account's existing sessions live after a recovery reset. One pinned
    // transaction makes every nested `withUserDatabaseContext` call reuse it (all-or-nothing);
    // a mid-operation failure rolls the password change back rather than committing it alone.
    await withTransaction((transaction) =>
      runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
        // Atomic UPDATE also prevents two concurrent resets from both succeeding.
        const record = await this.verificationTokenRepository.consumeIfValid(tokenHash);
        if (record?.token_type !== 'PASSWORD_RESET') {
          throw new UnauthorizedError('errors:invalidOrExpiredResetToken');
        }

        const user = await this.userService.findById(record.user_id);
        if (!user) throw new NotFoundError('User');

        await this.userService.updatePassword(user.public_id, passwordHash);
        await this.verificationTokenRepository.invalidateAllForUser(user.id, 'PASSWORD_RESET');

        // A reset is the recovery path for a potentially compromised account, so every existing
        // session is revoked. The Redis token-cache invalidation inside `revokeAllSessions` is a
        // sub-millisecond local call; on rollback it merely causes a cache miss, never a leak.
        await this.authSessionService.revokeAllSessions(user.public_id);
      }),
    );
  }

  async changePassword(
    userPublicId: string,
    body: unknown,
    options?: { currentAccessToken?: string },
  ): Promise<void> {
    const parsed = validateChangePassword(body);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    if (!user.password_hash) throw new UnauthorizedError('errors:passwordAuthNotEnabled');
    const { valid } = await verifyPassword(parsed.current_password, user.password_hash);
    if (!valid) throw new UnauthorizedError('errors:currentPasswordIncorrect');
    // Hash BEFORE the transaction: argon2 is CPU-bound (~100 ms) and must not hold a pooled
    // connection open inside the transaction.
    const passwordHash = await hashPassword(parsed.new_password);

    // audit-#4: the password update and the session revocation MUST be one atomic unit (the same
    // pinned-transaction pattern `resetPassword` already uses). Previously the password committed
    // first and session revocation ran afterward as a separate operation — a DB/Redis/process
    // failure in between left the new password in place while every existing (potentially
    // attacker-held) session stayed live, so a user changing their password to evict an attacker
    // could believe the account was secured while the stolen bearer token remained usable. The
    // pinned transaction makes nested `withUserDatabaseContext` calls reuse it, so a mid-operation
    // failure rolls the password change back rather than committing it alone.
    await withTransaction((transaction) =>
      runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
        const updatedUser = await this.userService.updatePassword(user.public_id, passwordHash);
        if (!updatedUser) throw new NotFoundError('User');

        // An authenticated change keeps the caller's current session and terminates
        // every other device. Without a current token we cannot single one out, so
        // fall back to revoking all sessions.
        if (options?.currentAccessToken) {
          await this.authSessionService.revokeAllSessionsExceptCurrent({
            userPublicId: user.public_id,
            currentAccessToken: options.currentAccessToken,
          });
        } else {
          await this.authSessionService.revokeAllSessions(user.public_id);
        }
      }),
    );
  }

  /**
   * Re-verifies the caller's password for a step-up ("sudo") re-authentication, without
   * mutating any state. Used by `POST /auth/step-up` so password users can open a short
   * recent-step-up window before a sensitive credential mutation. Throws on a missing user,
   * a passwordless account, or an incorrect password.
   *
   * @remarks
   * MFA-enabled users are rejected with `ForbiddenError('errors:mfaStepUpRequired')` BEFORE
   * the password hash is even compared. Without this, a transient stolen-session + known
   * password defeats the MFA invariant — the attacker could open the step-up window with
   * `/auth/step-up` and then immediately `DELETE /auth/mfa/:id` to convert a 15-minute
   * stolen bearer into permanent password-only access. MFA users must step up via
   * `/auth/mfa/verify` (which records the same recent-step-up sentinel). The check fires
   * before `verifyPassword` to avoid a password-timing oracle for MFA users (sec-A1).
   */
  async verifyPasswordForStepUp(options: {
    userPublicId: string;
    password: string;
  }): Promise<void> {
    const { userPublicId, password } = options;
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    if (user.is_mfa_enabled) {
      throw new ForbiddenError('errors:mfaStepUpRequired');
    }
    if (!user.password_hash) throw new UnauthorizedError('errors:passwordAuthNotEnabled');
    const { valid } = await verifyPassword(password, user.password_hash);
    if (!valid) throw new UnauthorizedError('errors:currentPasswordIncorrect');
  }

  // ── Email Verification ────────────────────────────────────────

  async verifyEmail(
    body: unknown,
  ): Promise<{ messageKey: string; messageParams?: Record<string, string | number> }> {
    const parsed = validateVerifyEmail(body);
    const tokenHash = createHash('sha256').update(parsed.token).digest('hex');

    // audit-#12: the token consumption and the verified-flag update must be ONE atomic unit.
    // Previously the token was consumed first and the user update ran separately, so a
    // transient failure after consumption permanently burned a valid single-use link and
    // forced the user to request another email (stranding onboarding during a provider
    // outage). The pinned transaction makes `consumeIfValid` roll back if the downstream
    // update fails, leaving the link retryable. The atomic UPDATE in `consumeIfValid` still
    // prevents two concurrent verifies from both succeeding.
    await withTransaction((transaction) =>
      runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
        const record = await this.verificationTokenRepository.consumeIfValid(tokenHash);
        if (record?.token_type !== 'EMAIL_VERIFICATION') {
          throw new UnauthorizedError('errors:invalidOrExpiredVerificationToken');
        }

        const user = await this.userService.findById(record.user_id);
        if (!user) throw new NotFoundError('User');

        await this.userService.updateEmailVerified(user.public_id);
      }),
    );

    return { messageKey: 'success:emailVerified' };
  }

  async resendEmailVerification(
    userPublicId: string,
    _context?: { requestId?: string },
  ): Promise<{ messageKey: string; messageParams?: Record<string, string | number> }> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    if (user.is_email_verified) {
      return { messageKey: 'success:emailAlreadyVerified' };
    }

    // Invalidate existing verification tokens
    await this.verificationTokenRepository.invalidateAllForUser(user.id, 'EMAIL_VERIFICATION');

    // Create new token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRES_IN_HOURS * 3_600_000);

    await this.verificationTokenRepository.create(
      'EMAIL_VERIFICATION',
      user.id,
      user.email,
      tokenHash,
      expiresAt,
    );

    await eventBus.emitStrict({
      type: AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED,
      payload: {
        email: user.email,
        verification_token: rawToken,
        expires_in_hours: EMAIL_VERIFICATION_EXPIRES_IN_HOURS,
      } satisfies EmailVerificationEmailPayload,
      timestamp: new Date(),
    });

    return { messageKey: 'success:verificationEmailSent' };
  }
}
