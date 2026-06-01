import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';
import { connectRedis, redisConnection } from '@/infrastructure/cache/redis.client.js';

/** Redis key prefixes cleared between integration tests (Postgres truncate does not touch Redis). */
/** Logical prefixes (ioredis `keyPrefix: 'core:'` is applied by redisConnection). */
const TEST_REDIS_PREFIXES = ['perm:', 'idempotency:', 'oauth:state:', 'session:tok:'] as const;

/**
 * `@fastify/rate-limit` stores counters under `<keyPrefix>fastify-rate-limit-<key>`. Every
 * test injects from the same socket, so the global limiter and the per-route presets all key on
 * IP `127.0.0.1`; on a fast machine a single 60s window accumulates enough requests across cases
 * to trip the cap and emit nondeterministic 429s (which cascade into 401s on dependent requests).
 * Clearing these between tests gives each case a fresh budget.
 *
 * The match pattern uses a leading wildcard because ioredis does NOT apply its `keyPrefix` to a
 * SCAN `MATCH` argument; SCAN returns fully-qualified keys, which are then stripped of the prefix
 * before DEL (which re-applies it). This stays correct whether or not a prefix is configured.
 */
async function clearRateLimitCounters(): Promise<void> {
  const keyPrefix = resolveRedisKeyPrefix();
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redisConnection.scan(
      cursor,
      'MATCH',
      '*fastify-rate-limit-*',
      'COUNT',
      500,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      const unprefixedKeys = keys.map((key) =>
        keyPrefix && key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key,
      );
      await redisConnection.del(...unprefixedKeys);
    }
  } while (cursor !== '0');
}

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

  await clearRateLimitCounters();
}
