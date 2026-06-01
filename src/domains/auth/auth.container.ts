import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import type { FastifyInstance } from 'fastify';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import { AuthMethodRepository } from './sub-domains/auth-method/auth-method.repository.js';
import { VerificationTokenRepository } from './sub-domains/auth-method/verification-token/verification-token.repository.js';
import { AuthSessionRepository } from './sub-domains/auth-session/auth-session.repository.js';
import { AuthService } from './auth.service.js';
import { AuthMethodService } from './sub-domains/auth-method/auth-method.service.js';
import { MagicLinkService } from './sub-domains/auth-method/magic-link.service.js';
import { OAuthService } from './sub-domains/auth-method/oauth/oauth.service.js';
import { MfaService } from './sub-domains/auth-mfa/auth-mfa.service.js';
import { WebauthnService } from './sub-domains/auth-webauthn/webauthn.service.js';
import { WebauthnCredentialRepository } from './sub-domains/auth-webauthn/webauthn-credential.repository.js';
import { AuthSessionService } from './sub-domains/auth-session/auth-session.service.js';

/** DI container shape for the auth domain: aggregates every sub-domain service consumed by routes, handlers, and other domains. */
export type AuthContainer = {
  authService: AuthService;
  authMethodService: AuthMethodService;
  magicLinkService: MagicLinkService;
  oauthService: OAuthService;
  mfaService: MfaService;
  webauthnService: WebauthnService;
  authSessionService: AuthSessionService;
};

/** Builds the auth-domain {@link AuthContainer}: instantiates auth-method, magic-link, OAuth, MFA, WebAuthn, and session services with their repositories and Redis. */
export function createAuthContainer(
  userService: UserService,
  organizationSettingsService: OrganizationSettingsService,
): AuthContainer {
  const authMethodRepository = new AuthMethodRepository();
  const verificationTokenRepository = new VerificationTokenRepository();
  const authSessionRepository = new AuthSessionRepository();

  const authSessionService = new AuthSessionService(userService, authSessionRepository);
  const authMethodService = new AuthMethodService(
    userService,
    authMethodRepository,
    verificationTokenRepository,
    authSessionService,
  );
  const mfaService = new MfaService(
    userService,
    authMethodService,
    authSessionService,
    redisConnection,
  );
  const authService = new AuthService(
    userService,
    authSessionService,
    mfaService,
    organizationSettingsService,
  );
  const magicLinkService = new MagicLinkService(
    userService,
    verificationTokenRepository,
    organizationSettingsService,
    mfaService,
    authSessionService,
  );
  const webauthnCredentialRepository = new WebauthnCredentialRepository();
  const webauthnService = new WebauthnService(
    userService,
    authSessionService,
    webauthnCredentialRepository,
    redisConnection,
    organizationSettingsService,
    mfaService,
  );
  const oauthService = new OAuthService(
    userService,
    authMethodService,
    authSessionService,
    redisConnection,
    organizationSettingsService,
    mfaService,
  );

  return {
    authService,
    authMethodService,
    magicLinkService,
    oauthService,
    mfaService,
    webauthnService,
    authSessionService,
  };
}

/** Decorates the Fastify instance with `app.authDomain` so routes and other domains can consume the auth services. */
export function registerAuthContainer(application: FastifyInstance): void {
  application.decorate(
    'authDomain',
    createAuthContainer(
      application.userDomain.userService,
      application.tenancyDomain.organizationSettingsService,
    ),
  );
}
