import type { Redis } from 'ioredis';
import { NotImplementedError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '../auth-method.service.js';
import type { AuthSessionService } from '../../auth-session/auth-session.service.js';
import { SUPPORTED_OAUTH_PROVIDERS } from './oauth.types.js';
import {
  assertOAuthProviderSupported,
  consumeOAuthState,
  createOAuthState,
} from './oauth-state.js';
import {
  buildGoogleOAuthRedirectUrl,
  exchangeGoogleOAuthCode,
} from './providers/google-oauth.provider.js';
import {
  buildGitHubOAuthRedirectUrl,
  exchangeGitHubOAuthCode,
} from './providers/github-oauth.provider.js';
import { completeOAuthUserSession } from './oauth-user-session.js';

export type { OAuthProvider } from './oauth.types.js';

/**
 * Coordinates the OAuth authorize-and-callback dance for supported providers.
 *
 * @remarks
 * - **Algorithm:** `getRedirectUrl` mints a CSRF `state` in Redis via
 *   {@link createOAuthState} and returns the provider authorize URL.
 *   `handleCallback` consumes the `state` exactly once via
 *   {@link consumeOAuthState}, exchanges the authorization code with the
 *   provider, then delegates to {@link completeOAuthUserSession} to find-or-create
 *   the user, link the auth method, and issue an access token + session.
 * - **Failure modes:** unsupported providers throw `NotImplementedError`;
 *   missing or mismatched `state` throws `UnauthorizedError`; provider code
 *   exchange surfaces network/parse errors to the caller.
 * - **Side effects:** writes to Redis (`oauth:state:*`), the {@link auth_methods}
 *   and `auth.sessions` tables, and signs a JWT. No event-bus emit — the user
 *   creation path inside `completeOAuthUserSession` calls into {@link UserService}.
 * - **Notes:** the `state` token is single-use (deleted on `consumeOAuthState`)
 *   to prevent replay and provider-mismatch attacks.
 */
export class OAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly authMethodService: AuthMethodService,
    private readonly authSessionService: AuthSessionService,
    private readonly redis: Redis,
  ) {}

  listProviders(): { providers: string[] } {
    return { providers: [...SUPPORTED_OAUTH_PROVIDERS] };
  }

  async getRedirectUrl(provider: string): Promise<{ redirect_url: string }> {
    const normalizedProvider = assertOAuthProviderSupported(provider);
    const state = await createOAuthState(this.redis, normalizedProvider);

    if (normalizedProvider === 'google') {
      return { redirect_url: buildGoogleOAuthRedirectUrl(state) };
    }
    if (normalizedProvider === 'github') {
      return { redirect_url: buildGitHubOAuthRedirectUrl(state) };
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
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<{ access_token: string; session_public_id: string }> {
    const ipAddress = options.ipAddress ?? '127.0.0.1';
    const normalizedProvider = await consumeOAuthState(this.redis, options.provider, options.state);

    const profile =
      normalizedProvider === 'google'
        ? await exchangeGoogleOAuthCode(
            omitUndefined({ code: options.code, requestId: options.requestId }),
          )
        : await exchangeGitHubOAuthCode(
            omitUndefined({ code: options.code, requestId: options.requestId }),
          );

    const session = await completeOAuthUserSession(
      omitUndefined({
        userService: this.userService,
        authMethodService: this.authMethodService,
        authSessionService: this.authSessionService,
        provider: normalizedProvider,
        profile,
        ipAddress,
        userAgent: options.userAgent,
      }),
    );

    return {
      access_token: session.access_token,
      session_public_id: session.session_public_id,
    };
  }
}
