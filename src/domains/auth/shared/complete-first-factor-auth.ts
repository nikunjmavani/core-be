import { createHash } from 'node:crypto';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { recordRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { env } from '@/shared/config/env.config.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/mfa.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';

/** User fields required to decide MFA policy and mint a session after first-factor success. */
export interface FirstFactorAuthUser {
  id: number;
  public_id: string;
  email: string;
  status: string;
  is_email_verified: boolean;
  is_mfa_enabled: boolean;
}

/** Result of a successful first-factor authentication step (password, magic link, OAuth, WebAuthn). */
export type FirstFactorAuthResult =
  | { access_token: string; session_public_id: string; session_refresh_secret: string }
  | { mfa_required: true; mfa_session_token: string };

/**
 * Central post-first-factor gate: enforces organization MFA policy before issuing a JWT/session.
 *
 * @remarks
 * Password login, magic link, OAuth, and WebAuthn must all call this helper so tenant-required MFA
 * cannot be bypassed by alternate authentication methods.
 */
export async function completeFirstFactorAuth(options: {
  user: FirstFactorAuthUser;
  ipAddress: string;
  userAgent?: string | undefined;
  organizationSettingsService: OrganizationSettingsService;
  mfaService: MfaService;
  authSessionService: AuthSessionService;
}): Promise<FirstFactorAuthResult> {
  const organizationRequiresMfa =
    await options.organizationSettingsService.userHasOrganizationRequiringMfa(options.user.id);
  if (options.user.is_mfa_enabled || organizationRequiresMfa) {
    const mfaSessionToken = await options.mfaService.createMfaSession(options.user.public_id);
    return { mfa_required: true, mfa_session_token: mfaSessionToken };
  }

  const jsonWebToken = await signAccessToken({
    userId: options.user.public_id,
    role: resolveAccessTokenRoleForUser({
      email: options.user.email,
      status: options.user.status,
      isEmailVerified: options.user.is_email_verified,
    }),
  });

  const tokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
  const sessionMaxAgeDays = env.AUTH_SESSION_MAX_AGE_DAYS;
  const expiresAt = new Date(Date.now() + sessionMaxAgeDays * 86_400_000);

  const session = await options.authSessionService.createSessionForUser(
    options.user.public_id,
    omitUndefined({
      token_hash: tokenHash,
      ip_address: options.ipAddress,
      user_agent: options.userAgent,
      expires_at: expiresAt,
    }),
  );

  await recordRecentStepUp(redisConnection, options.user.public_id);

  return {
    access_token: jsonWebToken,
    session_public_id: session.public_id,
    session_refresh_secret: session.refresh_secret,
  };
}
