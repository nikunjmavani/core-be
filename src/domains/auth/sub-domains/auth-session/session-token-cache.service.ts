import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { SESSION_TOKEN_CACHE_TTL_SECONDS } from '@/shared/constants/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const SESSION_TOKEN_CACHE_PREFIX = 'session:tok';

function buildSessionTokenCacheKey(tokenHash: string): string {
  return `${SESSION_TOKEN_CACHE_PREFIX}:${tokenHash}`;
}

/**
 * Returns true when the token hash was recently validated against an active session.
 */
export async function getCachedSessionTokenValid(tokenHash: string): Promise<boolean> {
  try {
    const cached = await redisConnection.get(buildSessionTokenCacheKey(tokenHash));
    return cached === '1';
  } catch (error) {
    logger.warn({ error }, 'session-token-cache.get.failed');
    return false;
  }
}

export async function setCachedSessionTokenValid(tokenHash: string): Promise<void> {
  try {
    await redisConnection.set(
      buildSessionTokenCacheKey(tokenHash),
      '1',
      'EX',
      SESSION_TOKEN_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn({ error }, 'session-token-cache.set.failed');
  }
}

export async function invalidateCachedSessionToken(tokenHash: string): Promise<void> {
  try {
    await redisConnection.del(buildSessionTokenCacheKey(tokenHash));
  } catch (error) {
    logger.warn({ error }, 'session-token-cache.invalidate.failed');
  }
}
