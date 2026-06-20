import {
  deriveBullMqRedisUrlFromCacheUrl,
  usesSeparateBullMqRedisEndpoint,
} from '@/infrastructure/cache/redis-url.parse.util.js';
import { env } from '@/shared/config/env.config.js';

export type { ParsedRedisUrl } from '@/infrastructure/cache/redis-url.parse.util.js';
export {
  deriveBullMqRedisUrlFromCacheUrl,
  isRedisTlsUrl,
  parseRedisUrl,
  usesSeparateBullMqRedisEndpoint,
  validateProductionRedisTopology,
} from '@/infrastructure/cache/redis-url.parse.util.js';

/**
 * BullMQ Redis URL — explicit REDIS_BULLMQ_URL or the shared REDIS_URL.
 */
export function resolveBullMqRedisUrl(): string {
  if (env.REDIS_BULLMQ_URL) {
    return env.REDIS_BULLMQ_URL;
  }
  return deriveBullMqRedisUrlFromCacheUrl(env.REDIS_URL);
}

/** True when cache and BullMQ use different logical databases or hosts (env-bound). */
export function usesSeparateBullMqRedisDatabase(): boolean {
  return usesSeparateBullMqRedisEndpoint(env.REDIS_URL, resolveBullMqRedisUrl());
}
