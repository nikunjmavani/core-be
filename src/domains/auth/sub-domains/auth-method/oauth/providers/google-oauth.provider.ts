import { NotImplementedError, UnauthorizedError } from '@/shared/errors/index.js';
import { env } from '@/shared/config/env.config.js';
import { buildOutboundFetchOptions, outboundFetch } from '@/infrastructure/outbound/index.js';
import { ExternalServiceError } from '@/infrastructure/outbound/outbound-error.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { OAuthProfile } from '../oauth.types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function getGoogleRedirectUri(): string {
  return (
    env.OAUTH_GOOGLE_REDIRECT_URI ??
    `${env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/oauth/google/callback`
  );
}

export function buildGoogleOAuthRedirectUrl(state: string): string {
  const clientId = env.OAUTH_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new NotImplementedError('errors:googleOAuthNotConfigured');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface ExchangeGoogleOAuthCodeOptions {
  code: string;
  requestId?: string;
}

export async function exchangeGoogleOAuthCode(
  options: ExchangeGoogleOAuthCodeOptions,
): Promise<OAuthProfile> {
  const clientId = env.OAUTH_GOOGLE_CLIENT_ID;
  const clientSecret = env.OAUTH_GOOGLE_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    throw new NotImplementedError('errors:googleOAuthNotConfigured');
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await outboundFetch(
      buildOutboundFetchOptions({
        name: 'oauth-google',
        url: GOOGLE_TOKEN_URL,
        requestId: options.requestId,
        expectedStatus: 200,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: options.code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: getGoogleRedirectUri(),
            grant_type: 'authorization_code',
          }),
        },
      }),
    );
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      throw new UnauthorizedError('errors:googleExchangeFailed');
    }
    throw error;
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new UnauthorizedError('errors:googleTokenMissingAccessToken');
  }

  let userInfoResponse: Response;
  try {
    userInfoResponse = await outboundFetch(
      buildOutboundFetchOptions({
        name: 'oauth-google',
        url: GOOGLE_USERINFO_URL,
        requestId: options.requestId,
        expectedStatus: 200,
        init: {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        },
      }),
    );
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      throw new UnauthorizedError('errors:googleFetchUserFailed');
    }
    throw error;
  }

  const userInfo = (await userInfoResponse.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  if (!(userInfo.email && userInfo.sub)) {
    throw new UnauthorizedError('errors:googleUserMissingEmailOrSub');
  }

  return omitUndefined({
    email: userInfo.email,
    name: userInfo.name,
    avatar_url: userInfo.picture,
    provider_user_id: userInfo.sub,
  });
}
