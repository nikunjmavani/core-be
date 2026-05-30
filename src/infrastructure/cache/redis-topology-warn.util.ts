import { usesSeparateBullMqRedisEndpoint } from '@/infrastructure/cache/redis-url.parse.util.js';
import { resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Logs the resolved Redis topology at boot. When BullMQ runs on a dedicated endpoint
 * (separate host or logical database from the cache `REDIS_URL`), this records that
 * queue/cache isolation is active — the recommended production topology so a BullMQ
 * backlog cannot starve the write-critical cache / idempotency / rate-limit store.
 * No-op when BullMQ shares the cache endpoint (single-instance local development).
 */
export function warnWhenBullMqSharesCacheRedisHost(): void {
  const bullMqRedisUrl = resolveBullMqRedisUrl();
  if (!usesSeparateBullMqRedisEndpoint(env.REDIS_URL, bullMqRedisUrl)) {
    return;
  }

  logger.info(
    {
      cacheRedisUrl: env.REDIS_URL.replace(/:[^@]+@/, ':***@'),
      bullMqRedisUrl: bullMqRedisUrl.replace(/:[^@]+@/, ':***@'),
    },
    'redis.topology.dedicated_bullmq_endpoint — BullMQ uses a dedicated Redis endpoint; queue/cache isolation is active (see docs/deployment/runbooks/redis-topology.md)',
  );
}
