import { Redis } from 'ioredis';
import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  keyPrefix: resolveRedisKeyPrefix(),
  enableReadyCheck: true,
  /** Fail fast when disconnected — avoids hanging HTTP handlers and chaos tests during partitions. */
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5_000);
    logger.warn({ attempt: times, delayMs: delay }, 'redis.reconnecting');
    return delay;
  },
});

redisConnection.on('error', (error) => {
  logger.error({ error }, 'redis.connection.error');
});

redisConnection.on('reconnecting', () => {
  logger.info('redis.reconnecting');
});

/**
 * Eagerly establishes the shared Redis connection and waits until it is ready.
 *
 * Combined with `lazyConnect: true` and `enableOfflineQueue: false`, the very
 * first command in a process would otherwise race the initial connect and
 * fail with "Stream isn't writeable and enableOfflineQueue options is false".
 *
 * Call once at process start (HTTP server, worker) before serving traffic or
 * registering schedulers. Idempotent and safe to call when already connected.
 */
export async function connectRedis(): Promise<void> {
  if (redisConnection.status === 'ready') return;

  if (redisConnection.status === 'wait') {
    await redisConnection.connect();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      redisConnection.off('ready', onReady);
      redisConnection.off('error', onError);
    };
    redisConnection.once('ready', onReady);
    redisConnection.once('error', onError);
  });
}

export async function closeRedis(): Promise<void> {
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn('redis.close.timeout');
      resolve();
    }, 5_000);
  });
  await Promise.race([redisConnection.quit(), timeout]);
}
