import type { Redis } from 'ioredis';
import { NotImplementedError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import { SUPPORTED_OAUTH_PROVIDERS } from './oauth.types.js';
import {
  assertOAuthProviderSupported,
  consumeOAuthState,
  createOAuthState,
} from './oauth-state.js';
import { derivePkceCodeChallengeS256 } from './oauth-pkce.js';
import {
  buildGoogleOAuthRedirectUrl,
  exchangeGoogleOAuthCode,
} from './providers/google-oauth.provider.js';
import {
  buildGitHubOAuthRedirectUrl,
  exchangeGitHubOAuthCode,
} from './providers/github-oauth.provider.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import { completeOAuthUserSession } from './oauth-user-session.js';
import type { FirstFactorAuthResult } from '@/domains/auth/shared/complete-first-factor-auth.js';

export type { OAuthProvider } from './oauth.types.js';

/**
 * Coordinates the OAuth authorize-and-callback dance for supported providers.
 *
 * @remarks
 * - **Algorithm:** `getRedirectUrl` mints a CSRF `state` plus an RFC 7636 PKCE
 *   verifier and a browser nonce via {@link createOAuthState}, returns the provider
 *   authorize URL (carrying the S256 `code_challenge`) and the `nonce` the handler
 *   sets as a cookie. `handleCallback` consumes the `state` exactly once via
 *   {@link consumeOAuthState} — which also enforces the browser nonce — sends the
 *   PKCE `code_verifier` at token exchange, then delegates to
 *   {@link completeOAuthUserSession} to find-or-create the user, link the auth
 *   method, and issue an access token + session.
 * - **Failure modes:** unsupported providers throw `NotImplementedError`;
 *   missing/mismatched `state`, a missing/mismatched browser nonce, or a tampered
 *   payload throw `UnauthorizedError`; provider code exchange surfaces
 *   network/parse errors to the caller.
 * - **Side effects:** writes to Redis (`oauth:state:*`), the {@link auth_methods}
 *   and `auth.sessions` tables, and signs a JWT. No event-bus emit — the user
 *   creation path inside `completeOAuthUserSession` calls into {@link UserService}.
 * - **Notes:** the `state` token is single-use (deleted on `consumeOAuthState`) to
 *   prevent replay; PKCE defeats authorization-code interception and the nonce
 *   binds the callback to the browser that began the flow (login-CSRF defence).
 */
export class OAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly authMethodService: AuthMethodService,
    private readonly authSessionService: AuthSessionService,
    private readonly redis: Redis,
    private readonly organizationSettingsService: OrganizationSettingsService,
    private readonly mfaService: MfaService,
  ) {}

  listProviders(): { providers: string[] } {
    return { providers: [...SUPPORTED_OAUTH_PROVIDERS] };
  }

  async getRedirectUrl(provider: string): Promise<{ redirect_url: string; nonce: string }> {
    const normalizedProvider = assertOAuthProviderSupported(provider);
    const { state, codeVerifier, nonce } = await createOAuthState(this.redis, normalizedProvider);
    const codeChallenge = derivePkceCodeChallengeS256(codeVerifier);

    if (normalizedProvider === 'google') {
      return { redirect_url: buildGoogleOAuthRedirectUrl(state, codeChallenge), nonce };
    }
    if (normalizedProvider === 'github') {
      return { redirect_url: buildGitHubOAuthRedirectUrl(state, codeChallenge), nonce };
    }

    throw new NotImplementedError(
      'errors:oauthProviderNotConfigured',
      { provider: normalizedProvider },
      `OAuth provider "${normalizedProvider}" is not configured.`,
    );
  }

  async handleCallback(options: {
    provider: string;
    code: string;
    state: string | undefined;
    nonce?: string | undefined;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<FirstFactorAuthResult> {
    const ipAddress = options.ipAddress ?? '127.0.0.1';
    const { provider: normalizedProvider, codeVerifier } = await consumeOAuthState(
      this.redis,
      options.provider,
      options.state,
      options.nonce,
    );

    const profile =
      normalizedProvider === 'google'
        ? await exchangeGoogleOAuthCode(
            omitUndefined({ code: options.code, codeVerifier, requestId: options.requestId }),
          )
        : await exchangeGitHubOAuthCode(
            omitUndefined({ code: options.code, codeVerifier, requestId: options.requestId }),
          );

    const session = await completeOAuthUserSession({
      userService: this.userService,
      authMethodService: this.authMethodService,
      authSessionService: this.authSessionService,
      organizationSettingsService: this.organizationSettingsService,
      mfaService: this.mfaService,
      provider: normalizedProvider,
      profile,
      ipAddress,
      ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
    });

    if ('mfa_required' in session) {
      return session;
    }

    return {
      access_token: session.access_token,
      session_public_id: session.session_public_id,
      session_refresh_secret: session.session_refresh_secret,
    };
  }
}
