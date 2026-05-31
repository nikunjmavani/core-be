import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { assertUserAccountActive } from '@/shared/utils/auth/account-status.util.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { DUMMY_ARGON2_HASH, verifyPassword } from '@/shared/utils/security/password.util.js';
import {
  ACCOUNT_LOCKOUT_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  MILLISECONDS_PER_MINUTE,
} from '@/shared/constants/index.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { AuthSessionService } from './sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from './sub-domains/auth-mfa/auth-mfa.service.js';
import { validateLogin } from './auth.validator.js';
import { completeFirstFactorAuth } from './shared/complete-first-factor-auth.js';

/**
 * Discriminated result of {@link AuthService.login}: either a fresh access token + session
 * public id, or an `mfa_required` envelope carrying a short-lived session token used by
 * the MFA login verify step.
 *
 * @remarks
 * - **Algorithm:** the password branch returns `{ access_token, session_public_id }`;
 *   when MFA is required by user opt-in or organization policy, the password is consumed
 *   without issuing a JWT and a Redis-backed MFA session token is returned instead.
 * - **Failure modes:** consumers should disambiguate via the `mfa_required` field before
 *   reading either union arm.
 * - **Side effects:** none — purely the result shape.
 * - **Notes:** the session is created server-side; clients use the session cookie for refresh.
 */
export type LoginResult =
  | { access_token: string; session_public_id: string; session_refresh_secret: string }
  | { mfa_required: true; mfa_session_token: string };

/**
 * Password-login orchestrator for the auth domain.
 *
 * @remarks
 * - **Algorithm:** lookup user by email, verify password (argon2 with optional rehash),
 *   then either issue a JWT + persisted session or return an `mfa_required` token when MFA
 *   is enabled on the user or required by org policy via
 *   {@link OrganizationSettingsService.userHasOrganizationRequiringMfa}. The account-lockout
 *   window is checked *after* password verification so a correct credential always bypasses
 *   it — the lock only rejects further failed attempts, preventing a victim-account DoS.
 * - **Failure modes:** disposable-email check throws `ValidationError`; bad password,
 *   missing user, locked account, expired session, inactive user all throw
 *   `UnauthorizedError` with i18n keys (`errors:invalidEmailOrPassword`,
 *   `errors:accountLocked`, `errors:invalidOrExpiredSession`, `errors:accountNotActive`).
 * - **Side effects:** increments / clears `users.failed_login_count` and sets
 *   `account_locked_until` after {@link MAX_FAILED_LOGIN_ATTEMPTS} failures; rehashes the
 *   stored password when argon2 parameters drift; creates and rotates rows in
 *   `auth.sessions` via {@link AuthSessionService}.
 * - **Notes:** access tokens are signed RS256 with a SHA-256 hash persisted on the
 *   session row (refresh uses the session, not the JWT, as the source of truth).
 */
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly authSessionService: AuthSessionService,
    private readonly mfaService: MfaService,
    private readonly organizationSettingsService: OrganizationSettingsService,
  ) {}

  async login(body: unknown, ipAddress: string, userAgent?: string): Promise<LoginResult> {
    const parsed = validateLogin(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }
    const user = await this.userService.findByEmail(parsed.email);
    if (!user?.password_hash) {
      // Run a verification against a fixed dummy hash and discard the result so
      // the "unknown email" path takes the same ~argon2 time as a wrong password,
      // preventing user enumeration via response timing.
      await verifyPassword(parsed.password, DUMMY_ARGON2_HASH);
      throw new UnauthorizedError('errors:invalidEmailOrPassword');
    }

    // Lockout is verified AFTER the password so that a correct credential always bypasses it.
    // Keying the hard lockout purely on the account makes it a victim-DoS vector: anyone who
    // knows the email could submit wrong passwords to lock the real owner out. Online brute
    // force is already bounded by the per-IP + per-email rate limits and CAPTCHA on /login, so
    // the lockout's job is narrowed to throttling *failed* attempts, never denying the owner.
    const isLockedOut = Boolean(
      user.account_locked_until && new Date(user.account_locked_until) > new Date(),
    );

    const { valid: isValid, needsRehash } = await verifyPassword(
      parsed.password,
      user.password_hash,
    );

    if (!isValid) {
      const failedCount = (user.failed_login_count ?? 0) + 1;
      const lockUntil =
        failedCount >= MAX_FAILED_LOGIN_ATTEMPTS
          ? new Date(Date.now() + ACCOUNT_LOCKOUT_MINUTES * MILLISECONDS_PER_MINUTE)
          : null;

      await this.userService.updateLoginAttempt(user.public_id, failedCount, lockUntil);
      // Surface accountLocked only when the credential was ALSO wrong (a correct password
      // would have bypassed the lock above), so the lock status is never an oracle for a
      // valid email and the lockout cannot be weaponized against the legitimate user.
      throw new UnauthorizedError(
        isLockedOut ? 'errors:accountLocked' : 'errors:invalidEmailOrPassword',
      );
    }

    // First factor verified — refuse to issue (or escalate to MFA for) a session
    // for a suspended/locked account before any token is minted.
    assertUserAccountActive(user.status);

    // Correct password clears the failure counter and lifts any active lock so the owner is
    // never held out by attacker-driven failed attempts.
    if ((user.failed_login_count ?? 0) > 0 || isLockedOut) {
      await this.userService.updateLoginAttempt(user.public_id, 0, null);
    }

    if (needsRehash) {
      const { hashPassword } = await import('@/shared/utils/security/password.util.js');
      const newHash = await hashPassword(parsed.password);
      await this.userService.updatePassword(user.public_id, newHash);
    }

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

  async logout(token: string): Promise<void> {
    await this.authSessionService.revokeSessionByAccessToken(token);
  }

  async refreshToken({
    sessionPublicId,
    refreshSecret,
  }: {
    sessionPublicId: string;
    refreshSecret: string;
  }): Promise<{ access_token: string; refresh_secret: string }> {
    const session = await this.authSessionService.findActiveSessionByPublicId(sessionPublicId);
    if (!session) {
      throw new UnauthorizedError('errors:invalidOrExpiredSession');
    }

    if (new Date(session.expires_at) <= new Date()) {
      throw new UnauthorizedError('errors:sessionExpired');
    }

    const user = await this.userService.findById(session.user_id);
    if (!user) throw new UnauthorizedError('errors:userNotFound');

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('errors:accountNotActive');
    }

    const jsonWebToken = await signAccessToken({
      userId: user.public_id,
      role: resolveAccessTokenRoleForUser({
        email: user.email,
        status: user.status,
        isEmailVerified: user.is_email_verified,
      }),
    });

    const rotated = await this.authSessionService.refreshSessionCredentials({
      sessionPublicId,
      refreshSecret,
      nextAccessToken: jsonWebToken,
    });

    return { access_token: jsonWebToken, refresh_secret: rotated.refresh_secret };
  }
}
