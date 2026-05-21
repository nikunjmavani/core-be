import { connectRedis, redisConnection } from '@/infrastructure/cache/redis.client.js';

/** Redis key prefixes cleared between integration tests (Postgres truncate does not touch Redis). */
/** Logical prefixes (ioredis `keyPrefix: 'core:'` is applied by redisConnection). */
const TEST_REDIS_PREFIXES = ['perm:', 'idempotency:', 'oauth:state:', 'session:tok:'] as const;

/**
 * Delete test-scoped Redis keys so permission cache, idempotency, and OAuth state
 * do not leak across Vitest cases in the same worker process.
 */
export async function cleanupTestRedis(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('cleanupTestRedis can only be called in test environment');
  }

  try {
    await connectRedis();
  } catch {
    return;
  }

  if (redisConnection.status !== 'ready') {
    return;
  }

  for (const prefix of TEST_REDIS_PREFIXES) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redisConnection.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        200,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redisConnection.del(...keys);
      }
    } while (cursor !== '0');
  }
}
