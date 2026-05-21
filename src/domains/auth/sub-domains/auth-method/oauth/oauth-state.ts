import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { NotImplementedError, UnauthorizedError } from '@/shared/errors/index.js';
import { OAUTH_STATE_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';
import { SUPPORTED_OAUTH_PROVIDERS, type OAuthProvider } from './oauth.types.js';

export { OAUTH_STATE_TTL_SECONDS };
export const OAUTH_STATE_KEY_PREFIX = 'oauth:state:';

export function normalizeOAuthProvider(provider: string): string {
  return provider.toLowerCase();
}

export function assertOAuthProviderSupported(provider: string): OAuthProvider {
  const normalizedProvider = normalizeOAuthProvider(provider);
  if (!SUPPORTED_OAUTH_PROVIDERS.includes(normalizedProvider as OAuthProvider)) {
    throw new NotImplementedError('errors:oauthProviderNotSupported');
  }
  return normalizedProvider as OAuthProvider;
}

export async function createOAuthState(redis: Redis, provider: OAuthProvider): Promise<string> {
  const state = randomBytes(32).toString('hex');
  await redis.set(`${OAUTH_STATE_KEY_PREFIX}${state}`, provider, 'EX', OAUTH_STATE_TTL_SECONDS);
  return state;
}

export async function consumeOAuthState(
  redis: Redis,
  provider: string,
  state: string | undefined,
): Promise<OAuthProvider> {
  if (!state || state.length === 0) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  const storedProvider = await redis.get(`${OAUTH_STATE_KEY_PREFIX}${state}`);
  if (!storedProvider) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }
  await redis.del(`${OAUTH_STATE_KEY_PREFIX}${state}`);

  const normalizedProvider = normalizeOAuthProvider(provider);
  if (storedProvider !== normalizedProvider) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  return assertOAuthProviderSupported(normalizedProvider);
}
