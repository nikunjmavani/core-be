import { createHash } from 'node:crypto';
import { ForbiddenError } from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '../auth-method.service.js';
import type { AuthSessionService } from '../../auth-session/auth-session.service.js';
import type { OAuthProfile, OAuthProvider } from './oauth.types.js';
import type { UserAuthRecord } from '@/domains/user/user.types.js';

export async function completeOAuthUserSession(parameters: {
  userService: UserService;
  authMethodService: AuthMethodService;
  authSessionService: AuthSessionService;
  provider: OAuthProvider;
  profile: OAuthProfile;
  ipAddress: string;
  userAgent?: string;
}): Promise<{ access_token: string; session_public_id: string; user: UserAuthRecord }> {
  const { userService, authMethodService, authSessionService, provider, profile } = parameters;

  let user = await userService.findByEmail(profile.email);
  if (!user) {
    if (isDisposableEmailBlocked(profile.email)) {
      throw new ForbiddenError('errors:disposableEmail');
    }
    const nameParts = profile.name?.split(' ') ?? [];
    user = await userService.createFromOAuth(
      omitUndefined({
        email: profile.email,
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(' ') || undefined,
        avatar_url: profile.avatar_url,
        is_email_verified: true,
      }),
    );
    logger.info({ email: profile.email, provider }, 'oauth.user.created');
  }

  await authMethodService.linkOAuthProviderIfMissing({
    user_id: user.id,
    method_type: 'oauth',
    provider,
    provider_user_id: profile.provider_user_id,
    is_primary: false,
    created_by_user_id: user.id,
  });

  const jsonWebToken = await signAccessToken({
    userId: user.public_id,
    role: resolveAccessTokenRoleForUser(user.email, user.status),
  });

  const tokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
  const sessionMaxAgeDays = env.AUTH_SESSION_MAX_AGE_DAYS;
  const expiresAt = new Date(Date.now() + sessionMaxAgeDays * 86_400_000);

  const session = await authSessionService.createSessionForUser(
    user.public_id,
    omitUndefined({
      token_hash: tokenHash,
      ip_address: parameters.ipAddress,
      user_agent: parameters.userAgent,
      expires_at: expiresAt,
    }),
  );

  return {
    access_token: jsonWebToken,
    session_public_id: session.public_id,
    user,
  };
}
