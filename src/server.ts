import '@/shared/config/load-env-files.js';
import {
  initSentry,
  captureException,
  flushSentry,
} from '@/infrastructure/observability/sentry/sentry.js';
import { connectRedis } from '@/infrastructure/cache/redis.client.js';
import { connectBullMqRedis } from '@/infrastructure/cache/bullmq-redis.client.js';
import { warnWhenBullMqSharesCacheRedisHost } from '@/infrastructure/cache/redis-topology-warn.util.js';
import { assertPostgresConnectionBudget } from '@/infrastructure/database/assert-connection-budget.js';
import { registerPostgresPoolMetrics } from '@/infrastructure/observability/metrics/db-pool-metrics.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { buildApp } from '@/app.js';

// Initialize Sentry before anything else
initSentry();

process.on('uncaughtException', (error) => {
  captureException(error, { tags: { source: 'uncaughtException' } });
  logger.fatal({ error }, 'uncaughtException');
  void flushSentry().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  captureException(reason, { tags: { source: 'unhandledRejection' } });
  logger.fatal({ reason }, 'unhandledRejection');
  void flushSentry().finally(() => process.exit(1));
});

async function main() {
  /** Avoids a startup race where the first request that hits idempotency / rate-limit
   * issues a direct command on the shared `redisConnection` (lazyConnect +
   * enableOfflineQueue:false) and fails with "Stream isn't writeable" before
   * the lazy connect completes. */
  await connectRedis();
  await connectBullMqRedis();
  warnWhenBullMqSharesCacheRedisHost();
  await assertPostgresConnectionBudget();
  registerPostgresPoolMetrics();

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HTTP_BIND_HOST });
  logger.info({ host: env.HTTP_BIND_HOST, port: env.PORT }, 'Server listening');
}

main().catch((error) => {
  captureException(error, { tags: { source: 'server_startup' } });
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error({ error: message, stack }, 'Server failed to start');
  void flushSentry().finally(() => process.exit(1));
});
