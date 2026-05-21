import { getEnv } from '@/shared/config/env.config.js';

/**
 * Resolves the Redis key prefix for cache, idempotency, rate limits, and BullMQ.
 * Defaults to `core:<NODE_ENV>:` when REDIS_KEY_PREFIX is unset.
 */
export function resolveRedisKeyPrefix(): string {
  const environment = getEnv();
  const override = environment.REDIS_KEY_PREFIX;
  if (override !== undefined && override.length > 0) {
    return override.endsWith(':') ? override : `${override}:`;
  }
  return `core:${environment.NODE_ENV}:`;
}
