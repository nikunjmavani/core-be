import { Redis } from 'ioredis';
import { resolveRedisKeyPrefix } from '@/infrastructure/cache/redis-prefix.util.js';
import { buildRedisTlsOptions } from '@/infrastructure/cache/redis-url.parse.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { FIVE_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_RECONNECT_DELAY_STEP_MS,
} from '@/infrastructure/cache/redis.constants.js';

/**
 * Process-wide ioredis client used by cache, idempotency, rate limits, permission cache,
 * circuit breaker state, and any non-BullMQ Redis access. `lazyConnect` + `enableOfflineQueue: false`
 * fail commands fast during partitions instead of buffering them; call {@link connectRedis}
 * once at boot before serving traffic. BullMQ uses its own connection helper (see
 * `bullmq-redis.client.ts` and `getBullMQConnectionOptions`).
 */
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  keyPrefix: resolveRedisKeyPrefix(),
  enableReadyCheck: true,
  /** Fail fast when disconnected — avoids hanging HTTP handlers and chaos tests during partitions. */
  enableOfflineQueue: false,
  /** Abort any command that has not received a reply within 3 s — guards against a connected-but-unresponsive Redis stalling HTTP request handlers indefinitely. */
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  /**
   * Dual-stack DNS lookup (IPv4 + IPv6). Required for Railway private networking
   * which exposes services over IPv6-only `.railway.internal` hostnames.
   */
  family: 0,
  /** Explicit TLS cert verification when REDIS_URL is rediss:// (no-op for plaintext redis://). */
  ...buildRedisTlsOptions(env.REDIS_URL),
  retryStrategy(times: number) {
    const delay = Math.min(times * REDIS_RECONNECT_DELAY_STEP_MS, FIVE_SECONDS_MS);
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

  if (
    redisConnection.status === 'wait' ||
    redisConnection.status === 'end' ||
    redisConnection.status === 'close'
  ) {
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

/**
 * Closes the shared Redis client during graceful shutdown. Races a 5s timeout so a
 * misbehaving Redis cannot stall process exit; the timeout is logged and treated as
 * resolved.
 */
export async function closeRedis(): Promise<void> {
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn('redis.close.timeout');
      resolve();
    }, FIVE_SECONDS_MS);
  });
  await Promise.race([redisConnection.quit(), timeout]);
}
