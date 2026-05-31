import { ForbiddenError } from '@/shared/errors/index.js';
import { assertUserAccountActive } from '@/shared/utils/auth/account-status.util.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withTransaction } from '@/infrastructure/database/transaction.js';
import {
  runWithPinnedDatabaseHandle,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import { AUTH_METHOD_TYPE } from '@/domains/auth/sub-domains/auth-method/auth-method.constants.js';
import {
  completeFirstFactorAuth,
  type FirstFactorAuthResult,
} from '@/domains/auth/shared/complete-first-factor-auth.js';
import type { OAuthProfile, OAuthProvider } from './oauth.types.js';
import type { UserAuthRecord } from '@/domains/user/user.types.js';

/** Final stage of an OAuth callback: finds-or-creates the user, idempotently links the OAuth provider via {@link AuthMethodService.linkOAuthProviderIfMissing}, then mints an access token + persisted session. The find-or-create, provider link, and session issuance run inside a single {@link withTransaction} pinned through {@link runWithPinnedDatabaseHandle}, so a failed auth-method insert (e.g. the `method_type` CHECK) rolls back the freshly created user instead of leaving a verified orphan. Inserts use {@link AUTH_METHOD_TYPE.OAUTH} to match the database CHECK constraint. Rejects disposable emails for first-time signups. Refuses to silently find-or-link into a pre-existing account whose email is not verified (unless that OAuth identity is already linked), throwing `ForbiddenError` to prevent account takeover. Rejects suspended/locked accounts with `UnauthorizedError('errors:accountNotActive')` before issuing a session. */
export async function completeOAuthUserSession(parameters: {
  userService: UserService;
  authMethodService: AuthMethodService;
  authSessionService: AuthSessionService;
  organizationSettingsService: OrganizationSettingsService;
  mfaService: MfaService;
  provider: OAuthProvider;
  profile: OAuthProfile;
  ipAddress: string;
  userAgent?: string;
}): Promise<FirstFactorAuthResult & { user: UserAuthRecord }> {
  const {
    userService,
    authMethodService,
    authSessionService,
    organizationSettingsService,
    mfaService,
    provider,
    profile,
  } = parameters;

  // Wrap the whole signup flow in one transaction and pin its handle in ALS so
  // every repository call (user insert, auth-method link, session insert) shares
  // the same checkout. runWithPinnedDatabaseHandle preserves any existing
  // organization context, so this composes with the tenant RLS wrapper; OAuth
  // callbacks carry no organization, falling back to the request pool checkout.
  return withTransaction((transaction) =>
    runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
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
      } else {
        // Account-takeover guard: a pre-existing account (e.g. created by password)
        // must not be silently merged into via find-or-link. Only auto-link when this
        // OAuth identity is already linked to the account, or the account's email is
        // already verified (proving the account owner controls the address). Otherwise
        // require explicit linking from an authenticated session.
        const existingProviderMethod = await authMethodService.findByProviderUserId(
          provider,
          profile.provider_user_id,
        );
        const isOAuthIdentityAlreadyLinked = existingProviderMethod?.user_id === user.id;
        if (!(isOAuthIdentityAlreadyLinked || user.is_email_verified)) {
          logger.warn(
            { email: profile.email, provider },
            'oauth.user.link_blocked_unverified_account',
          );
          throw new ForbiddenError('errors:oauthLinkRequiresVerifiedAccount');
        }
      }

      await authMethodService.linkOAuthProviderIfMissing({
        ownerPublicId: user.public_id,
        data: {
          user_id: user.id,
          method_type: AUTH_METHOD_TYPE.OAUTH,
          provider,
          provider_user_id: profile.provider_user_id,
          is_primary: false,
          created_by_user_id: user.id,
        },
      });

      // A pre-existing account may have been suspended/locked since signup; never
      // mint a session for it via the OAuth callback (freshly created users are ACTIVE).
      assertUserAccountActive(user.status);

      const authResult = await completeFirstFactorAuth({
        user: {
          id: user.id,
          public_id: user.public_id,
          email: user.email,
          status: user.status,
          is_email_verified: user.is_email_verified,
          is_mfa_enabled: user.is_mfa_enabled,
        },
        ipAddress: parameters.ipAddress,
        userAgent: parameters.userAgent,
        organizationSettingsService,
        mfaService,
        authSessionService,
      });

      return { ...authResult, user };
    }),
  );
}
