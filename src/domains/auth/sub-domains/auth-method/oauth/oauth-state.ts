import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { NotImplementedError, UnauthorizedError } from '@/shared/errors/index.js';
import { OAUTH_STATE_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';
import { SUPPORTED_OAUTH_PROVIDERS, type OAuthProvider } from './oauth.types.js';

export { OAUTH_STATE_TTL_SECONDS };
/** Redis key prefix for stored OAuth `state` tokens (CSRF defence on the authorize round-trip). */
export const OAUTH_STATE_KEY_PREFIX = 'oauth:state:';

/** Lower-cases the provider slug (`Google` → `google`) so storage/comparison is case-insensitive. */
export function normalizeOAuthProvider(provider: string): string {
  return provider.toLowerCase();
}

/** Normalises the provider slug and ensures it belongs to {@link SUPPORTED_OAUTH_PROVIDERS}; otherwise throws `NotImplementedError`. */
export function assertOAuthProviderSupported(provider: string): OAuthProvider {
  const normalizedProvider = normalizeOAuthProvider(provider);
  if (!SUPPORTED_OAUTH_PROVIDERS.includes(normalizedProvider as OAuthProvider)) {
    throw new NotImplementedError('errors:oauthProviderNotSupported');
  }
  return normalizedProvider as OAuthProvider;
}

/** Mints a 32-byte hex `state` token and stores `<prefix><state> = provider` in Redis with {@link OAUTH_STATE_TTL_SECONDS} TTL; the value is later consumed by {@link consumeOAuthState}. */
export async function createOAuthState(redis: Redis, provider: OAuthProvider): Promise<string> {
  const state = randomBytes(32).toString('hex');
  await redis.set(`${OAUTH_STATE_KEY_PREFIX}${state}`, provider, 'EX', OAUTH_STATE_TTL_SECONDS);
  return state;
}

/** Single-use lookup of an OAuth `state` token: atomically reads-and-deletes the Redis entry (`GETDEL`) and verifies it was issued for the same provider; throws `UnauthorizedError` (`errors:oauthInvalidState`) otherwise. The atomic consume guarantees only one of two concurrent callbacks can read a non-null value, preventing state replay in a GET-then-DEL race. */
export async function consumeOAuthState(
  redis: Redis,
  provider: string,
  state: string | undefined,
): Promise<OAuthProvider> {
  if (!state || state.length === 0) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  const storedProvider = await redis.getdel(`${OAUTH_STATE_KEY_PREFIX}${state}`);
  if (!storedProvider) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  const normalizedProvider = normalizeOAuthProvider(provider);
  if (storedProvider !== normalizedProvider) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  return assertOAuthProviderSupported(normalizedProvider);
}
