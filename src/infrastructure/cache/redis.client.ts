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
  /**
   * Gate command dispatch on a server READY check (INFO `loading:0`) in real runtimes, so a client
   * that connects to a Redis still loading its RDB does not fire commands that return `-LOADING`.
   *
   * Disabled under `test` (#786): the test harness shares this per-worker singleton across many
   * `createTestApp` instances, and at the Vitest worker's final teardown a reconnect's INFO
   * ready-check rejects against the closing stream (`Stream isn't writeable and enableOfflineQueue
   * options is false`) — an unhandled rejection that flakily fails an otherwise-green run even
   * though no assertion failed. Local/CI test Redis is always ready immediately, so skipping the
   * ready-check changes nothing the suites rely on while removing the only command ioredis emits at
   * reconnect (the source of the dangling rejection).
   *
   * Reads raw `process.env.NODE_ENV` (not the `env` const): the const is frozen at the first
   * env.config import — which happens via `load-env-files` before the test harness sets
   * `NODE_ENV=test` — so it would still read `local` here. `process.env` is always current and needs
   * no env-config mock (matching the existing `process.env.RUN_REDIS_TESTS` test gate).
   */
  enableReadyCheck: process.env.NODE_ENV !== 'test',
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
