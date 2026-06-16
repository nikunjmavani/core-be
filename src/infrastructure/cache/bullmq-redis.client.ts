import { Redis } from 'ioredis';
import { buildRedisTlsOptions } from '@/infrastructure/cache/redis-url.parse.util.js';
import {
  resolveBullMqRedisUrl,
  usesSeparateBullMqRedisDatabase,
} from '@/infrastructure/cache/redis-url.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { FIVE_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import { REDIS_RECONNECT_DELAY_STEP_MS } from '@/infrastructure/cache/redis.constants.js';

const bullMqRedisUrl = resolveBullMqRedisUrl();

/**
 * Dedicated Redis connection for BullMQ health probes when an override endpoint is configured.
 * BullMQ queues use {@link getBullMQConnectionOptions} — not this client's keyPrefix.
 */
export const bullmqRedisConnection = new Redis(bullMqRedisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  /**
   * Dual-stack DNS lookup (IPv4 + IPv6). Required for Railway private networking
   * which exposes services over IPv6-only `.railway.internal` hostnames.
   */
  family: 0,
  /** Explicit TLS cert verification when the BullMQ URL is rediss:// (no-op for plaintext redis://). */
  ...buildRedisTlsOptions(bullMqRedisUrl),
  retryStrategy(times: number) {
    const delay = Math.min(times * REDIS_RECONNECT_DELAY_STEP_MS, FIVE_SECONDS_MS);
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

  if (
    bullmqRedisConnection.status === 'wait' ||
    bullmqRedisConnection.status === 'end' ||
    bullmqRedisConnection.status === 'close'
  ) {
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

/**
 * Closes the dedicated BullMQ Redis client during graceful shutdown. No-op when BullMQ
 * shares the cache Redis endpoint (closing the cache client is sufficient). Races a 5s
 * timeout so a misbehaving Redis cannot stall process exit.
 */
export async function closeBullMqRedis(): Promise<void> {
  if (!usesSeparateBullMqRedisDatabase()) {
    return;
  }

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn('redis.bullmq.close.timeout');
      resolve();
    }, FIVE_SECONDS_MS);
  });
  await Promise.race([bullmqRedisConnection.quit(), timeout]);
}
