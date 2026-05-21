import { usesSeparateBullMqRedisEndpoint } from '@/infrastructure/cache/redis-url.parse.util.js';
import { resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Logs a warning when BullMQ uses a separate Redis endpoint while single-instance
 * Redis is the expected topology.
 */
export function warnWhenBullMqSharesCacheRedisHost(): void {
  const bullMqRedisUrl = resolveBullMqRedisUrl();
  if (!usesSeparateBullMqRedisEndpoint(env.REDIS_URL, bullMqRedisUrl)) {
    return;
  }

  logger.warn(
    {
      cacheRedisUrl: env.REDIS_URL.replace(/:[^@]+@/, ':***@'),
      bullMqRedisUrl: bullMqRedisUrl.replace(/:[^@]+@/, ':***@'),
    },
    'redis.topology.separate_endpoint — BullMQ and cache use separate Redis endpoints; current deployment topology expects one shared Redis instance (see docs/deployment/runbooks/redis-topology.md)',
  );
}
