import '@/shared/config/load-env-files.js';
import {
  initSentry,
  captureException,
  flushSentry,
} from '@/infrastructure/observability/sentry/sentry.js';
import { createUnhandledRejectionHandler } from '@/infrastructure/observability/unhandled-rejection.handler.js';
import { connectRedis } from '@/infrastructure/cache/redis.client.js';
import { connectBullMqRedis } from '@/infrastructure/cache/bullmq-redis.client.js';
import { warnWhenBullMqSharesCacheRedisHost } from '@/infrastructure/cache/redis-topology-warn.util.js';
import { assertPostgresConnectionBudget } from '@/infrastructure/database/assert-connection-budget.js';
import { assertDatabaseRoleRlsSafety } from '@/infrastructure/database/assert-database-rls-safety.js';
import { assertDatabaseTlsVerification } from '@/infrastructure/database/assert-database-tls-safety.js';
import { assertRedisTlsVerification } from '@/infrastructure/cache/assert-redis-tls-safety.js';
import { registerPostgresPoolMetrics } from '@/infrastructure/observability/metrics/db-pool-metrics.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { assertHostedTrustProxyConfigured } from '@/shared/utils/http/trust-proxy.util.js';
import { buildApp } from '@/app.js';

// Initialize Sentry before anything else
initSentry();

process.on('uncaughtException', (error) => {
  captureException(error, { tags: { source: 'uncaughtException' } });
  logger.fatal({ error }, 'uncaughtException');
  void flushSentry().finally(() => process.exit(1));
});

/**
 * Unhandled-rejection policy: a single un-awaited promise rejection (often from a
 * dependency) should NOT tear down the process and drop all in-flight requests, so
 * we meter (`process_unhandled_rejections_total`) + capture + log at error level
 * instead of exiting. We only escalate to a fatal exit if rejections arrive in a
 * sustained burst within a rolling window — a likely systemic failure — letting the
 * supervisor restart a genuinely broken process while tolerating isolated strays.
 * The metric exposes the sub-threshold rate so a persistent failing path can page
 * before it hides indefinitely. (`uncaughtException` keeps the stricter exit behavior.)
 */
process.on(
  'unhandledRejection',
  createUnhandledRejectionHandler({ process: 'api', sentrySource: 'unhandledRejection' }),
);

async function main() {
  /**
   * Fail fast on insecure transport / proxy configuration before opening any connection
   * or binding the listener. All three are no-ops outside hosted deployments.
   */
  assertDatabaseTlsVerification();
  assertRedisTlsVerification();
  assertHostedTrustProxyConfigured();

  /** Avoids a startup race where the first request that hits idempotency / rate-limit
   * issues a direct command on the shared `redisConnection` (lazyConnect +
   * enableOfflineQueue:false) and fails with "Stream isn't writeable" before
   * the lazy connect completes. */
  await connectRedis();
  await connectBullMqRedis();
  warnWhenBullMqSharesCacheRedisHost();
  await assertPostgresConnectionBudget();
  await assertDatabaseRoleRlsSafety();
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
