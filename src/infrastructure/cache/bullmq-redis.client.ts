import { Redis } from 'ioredis';
import {
  resolveBullMqRedisUrl,
  usesSeparateBullMqRedisDatabase,
} from '@/infrastructure/cache/redis-url.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Dedicated Redis connection for BullMQ health probes when an override endpoint is configured.
 * BullMQ queues use {@link getBullMQConnectionOptions} — not this client's keyPrefix.
 */
export const bullmqRedisConnection = new Redis(resolveBullMqRedisUrl(), {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  /**
   * Dual-stack DNS lookup (IPv4 + IPv6). Required for Railway private networking
   * which exposes services over IPv6-only `.railway.internal` hostnames.
   */
  family: 0,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5_000);
    logger.warn({ attempt: times, delayMs: delay }, 'redis.bullmq.reconnecting');
    return delay;
  },
});

bullmqRedisConnection.on('error', (error) => {
  logger.error({ error }, 'redis.bullmq.connection.error');
});

/**
 * Eagerly connects the BullMQ Redis client when it uses a separate endpoint from cache Redis.
 */
export async function connectBullMqRedis(): Promise<void> {
  if (!usesSeparateBullMqRedisDatabase()) {
    return;
  }

  if (bullmqRedisConnection.status === 'ready') {
    return;
  }

  if (bullmqRedisConnection.status === 'wait') {
    await bullmqRedisConnection.connect();
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
      bullmqRedisConnection.off('ready', onReady);
      bullmqRedisConnection.off('error', onError);
    };
    bullmqRedisConnection.once('ready', onReady);
    bullmqRedisConnection.once('error', onError);
  });
}

export async function closeBullMqRedis(): Promise<void> {
  if (!usesSeparateBullMqRedisDatabase()) {
    return;
  }

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn('redis.bullmq.close.timeout');
      resolve();
    }, 5_000);
  });
  await Promise.race([bullmqRedisConnection.quit(), timeout]);
}
