import {
  deriveBullMqRedisUrlFromCacheUrl,
  resolveRedisHostFromUrl,
  usesSeparateBullMqRedisEndpoint,
  usesSeparateBullMqRedisHost,
} from '@/infrastructure/cache/redis-url.parse.util.js';
import { env } from '@/shared/config/env.config.js';

export type { ParsedRedisUrl } from '@/infrastructure/cache/redis-url.parse.util.js';
export {
  deriveBullMqRedisUrlFromCacheUrl,
  parseRedisUrl,
  resolveRedisHostFromUrl,
  usesSeparateBullMqRedisHost,
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

/** Cache Redis hostname from {@link env.REDIS_URL}. */
export function resolveCacheRedisHost(): string {
  return resolveRedisHostFromUrl(env.REDIS_URL);
}

/** BullMQ Redis hostname from resolved BullMQ URL. */
export function resolveBullMqRedisHost(): string {
  return resolveRedisHostFromUrl(resolveBullMqRedisUrl());
}

/** True when cache and BullMQ use different Redis hosts (env-bound). */
export function usesSeparateBullMqRedisHostFromEnv(): boolean {
  return usesSeparateBullMqRedisHost(env.REDIS_URL, resolveBullMqRedisUrl());
}

/** True when cache and BullMQ use different logical databases or hosts (env-bound). */
export function usesSeparateBullMqRedisDatabase(): boolean {
  return usesSeparateBullMqRedisEndpoint(env.REDIS_URL, resolveBullMqRedisUrl());
}
