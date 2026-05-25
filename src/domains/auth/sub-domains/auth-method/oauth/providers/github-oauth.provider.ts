import { NotImplementedError, UnauthorizedError } from '@/shared/errors/index.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { OAuthProfile } from '../oauth.types.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

function getGitHubRedirectUri(): string {
  return (
    env.OAUTH_GITHUB_REDIRECT_URI ??
    `${env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/oauth/github/callback`
  );
}

export function buildGitHubOAuthRedirectUrl(state: string): string {
  const clientId = env.OAUTH_GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new NotImplementedError('errors:githubOAuthNotConfigured');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGitHubRedirectUri(),
    scope: 'read:user user:email',
    state,
  });

  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGitHubOAuthCode(code: string): Promise<OAuthProfile> {
  const clientId = env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = env.OAUTH_GITHUB_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    throw new NotImplementedError('errors:githubOAuthNotConfigured');
  }

  const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenResponse.ok) {
    logger.error(
      { status: tokenResponse.status, body: await tokenResponse.text() },
      'oauth.github.token_exchange.failed',
    );
    throw new UnauthorizedError('errors:githubExchangeFailed');
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
  };
  if (tokenData.error || !tokenData.access_token) {
    throw new UnauthorizedError(
      'errors:githubTokenMissing',
      undefined,
      tokenData.error ?? 'GitHub token response missing access_token',
    );
  }

  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!userResponse.ok) {
    throw new UnauthorizedError('errors:githubFetchUserFailed');
  }

  const userInfo = (await userResponse.json()) as {
    id?: number;
    name?: string;
    avatar_url?: string;
    email?: string;
  };

  let email = userInfo.email;
  if (!email) {
    const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      const primaryEmail = emails.find(
        (emailRecord) => emailRecord.primary && emailRecord.verified,
      );
      email = primaryEmail?.email ?? emails[0]?.email;
    }
  }

  if (!(email && userInfo.id)) {
    throw new UnauthorizedError('errors:githubUserMissingEmailOrId');
  }

  return omitUndefined({
    email,
    name: userInfo.name,
    avatar_url: userInfo.avatar_url,
    provider_user_id: String(userInfo.id),
  });
}
