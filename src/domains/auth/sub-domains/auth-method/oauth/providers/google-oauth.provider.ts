import { NotImplementedError, UnauthorizedError } from '@/shared/errors/index.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
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

export async function exchangeGoogleOAuthCode(code: string): Promise<OAuthProfile> {
  const clientId = env.OAUTH_GOOGLE_CLIENT_ID;
  const clientSecret = env.OAUTH_GOOGLE_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    throw new NotImplementedError('errors:googleOAuthNotConfigured');
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    logger.error(
      { status: tokenResponse.status, body: await tokenResponse.text() },
      'oauth.google.token_exchange.failed',
    );
    throw new UnauthorizedError('errors:googleExchangeFailed');
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new UnauthorizedError('errors:googleTokenMissingAccessToken');
  }

  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!userInfoResponse.ok) {
    throw new UnauthorizedError('errors:googleFetchUserFailed');
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
