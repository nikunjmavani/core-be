import { createHash } from 'node:crypto';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { verifyPassword } from '@/shared/utils/security/password.util.js';
import { env } from '@/shared/config/env.config.js';
import {
  ACCOUNT_LOCKOUT_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  MILLISECONDS_PER_MINUTE,
} from '@/shared/constants/index.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { AuthSessionService } from './sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from './sub-domains/auth-mfa/mfa.service.js';
import { validateLogin } from './auth.validator.js';

export type LoginResult =
  | { access_token: string; session_public_id: string }
  | { mfa_required: true; mfa_session_token: string };

/**
 * Verifies credentials, issues access tokens, and tracks failed login attempts
 * with an organization-aware lockout window.
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
      throw new UnauthorizedError('errors:invalidEmailOrPassword');
    }

    if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
      throw new UnauthorizedError('errors:accountLocked');
    }

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
      throw new UnauthorizedError('errors:invalidEmailOrPassword');
    }

    if (user.failed_login_count > 0) {
      await this.userService.updateLoginAttempt(user.public_id, 0, null);
    }

    if (needsRehash) {
      const { hashPassword } = await import('@/shared/utils/security/password.util.js');
      const newHash = await hashPassword(parsed.password);
      await this.userService.updatePassword(user.public_id, newHash);
    }

    const organizationRequiresMfa =
      await this.organizationSettingsService.userHasOrganizationRequiringMfa(user.id);
    if (user.is_mfa_enabled || organizationRequiresMfa) {
      const mfaSessionToken = await this.mfaService.createMfaSession(user.public_id);
      return { mfa_required: true, mfa_session_token: mfaSessionToken };
    }

    const jsonWebToken = await signAccessToken({
      userId: user.public_id,
      role: resolveAccessTokenRoleForUser(user.email, user.status),
    });

    const tokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
    const sessionMaxAgeDays = env.AUTH_SESSION_MAX_AGE_DAYS;
    const expiresAt = new Date(Date.now() + sessionMaxAgeDays * 86_400_000);

    const session = await this.authSessionService.createSessionForUser(
      user.public_id,
      omitUndefined({
        token_hash: tokenHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
      }),
    );

    return { access_token: jsonWebToken, session_public_id: session.public_id };
  }

  async logout(token: string): Promise<void> {
    await this.authSessionService.revokeSessionByAccessToken(token);
  }

  async refreshToken(sessionPublicId: string): Promise<{ access_token: string }> {
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
      role: resolveAccessTokenRoleForUser(user.email, user.status),
    });

    const tokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
    await this.authSessionService.rotateSessionTokenHash(session.public_id, tokenHash);

    return { access_token: jsonWebToken };
  }
}
