import type { AuthContainer } from './auth.container.js';
import { createAuthLoginHandlers } from './auth-login.handlers.js';
import { createAuthSessionHandlers } from './auth-session.handlers.js';
import { createAuthMagicLinkHandlers } from './auth-magic-link.handlers.js';
import { createAuthOauthHandlers } from './auth-oauth.handlers.js';
import { createAuthAuthMethodHandlers } from './auth-auth-method.handlers.js';
import { createAuthMfaHandlers } from './auth-mfa.handlers.js';
import { createAuthWebauthnHandlers } from './auth-webauthn.handlers.js';

export function createAuthController(container: AuthContainer) {
  return {
    ...createAuthLoginHandlers(container),
    ...createAuthSessionHandlers(container),
    ...createAuthMagicLinkHandlers(container),
    ...createAuthOauthHandlers(container),
    ...createAuthAuthMethodHandlers(container),
    ...createAuthMfaHandlers(container),
    ...createAuthWebauthnHandlers(container),
  };
}
