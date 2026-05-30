import '@/shared/config/load-env-files.js';
import {
  initSentry,
  captureException,
  flushSentry,
} from '@/infrastructure/observability/sentry/sentry.js';
import { createUnhandledRejectionHandler } from '@/infrastructure/observability/unhandled-rejection.handler.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { closeRedis, connectRedis } from '@/infrastructure/cache/redis.client.js';
import {
  closeBullMqRedis,
  connectBullMqRedis,
} from '@/infrastructure/cache/bullmq-redis.client.js';
import { warnWhenBullMqSharesCacheRedisHost } from '@/infrastructure/cache/redis-topology-warn.util.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { assertPostgresConnectionBudget } from '@/infrastructure/database/assert-connection-budget.js';
import { assertDatabaseRoleRlsSafety } from '@/infrastructure/database/assert-database-rls-safety.js';
import { assertDatabaseTlsVerification } from '@/infrastructure/database/assert-database-tls-safety.js';
import { assertRedisTlsVerification } from '@/infrastructure/cache/assert-redis-tls-safety.js';
import { computeWorkerPostgresPoolDemand } from '@/infrastructure/queue/worker-runtime/worker-connection-budget.js';
import { setWorkerPostgresPoolDemandContext } from '@/infrastructure/queue/worker-runtime/worker-pool-demand-context.js';
import { registerPostgresPoolMetrics } from '@/infrastructure/observability/metrics/db-pool-metrics.js';
import {
  registerDomainWorkers,
  stopRssMonitoring,
  closeDeadLetterQueues,
} from '@/infrastructure/queue/bootstrap.js';
import { closeWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import {
  markWorkerHealthNotReady,
  markWorkerHealthReady,
  startWorkerHealthServer,
  stopWorkerHealthServer,
} from '@/infrastructure/queue/worker-runtime/worker-health.server.js';
import { getShutdownWatchdogMs } from '@/infrastructure/queue/worker-runtime/shutdown-timing.util.js';
import { closeStripeWebhookQueue } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { closeMailQueue } from '@/infrastructure/mail/queues/mail.queue.js';
import { closeNotificationQueue } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { closeWebhookDeliveryQueue } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';

// Initialize Sentry before anything else
initSentry();

process.on('uncaughtException', (error) => {
  captureException(error, { tags: { source: 'worker_uncaughtException' } });
  logger.fatal({ error }, 'uncaughtException');
  void flushSentry().finally(() => process.exit(1));
});

/**
 * Unhandled-rejection policy: a single un-awaited promise rejection (often from a
 * dependency) should NOT tear down the worker and abandon in-flight jobs, so we
 * meter (`process_unhandled_rejections_total`) + capture + log at error level instead
 * of exiting. We only escalate to a fatal exit if rejections arrive in a sustained
 * burst within a rolling window — a likely systemic failure — letting the supervisor
 * restart a genuinely broken process while tolerating isolated strays. The metric
 * exposes the sub-threshold rate so a persistent failing job path can page before it
 * hides indefinitely. (`uncaughtException` keeps the stricter exit behavior.)
 */
process.on(
  'unhandledRejection',
  createUnhandledRejectionHandler({ process: 'worker', sentrySource: 'worker_unhandledRejection' }),
);

async function main() {
  process.env.CORE_BE_RUNTIME = 'worker';

  /** Fail fast on insecure DB/Redis transport before opening connections. No-op outside hosted. */
  assertDatabaseTlsVerification();
  assertRedisTlsVerification();

  /** Avoids a startup race where the first scheduled job's direct command on the shared
   * `redisConnection` (lazyConnect + enableOfflineQueue:false) fails with
   * "Stream isn't writeable" before the lazy connect completes. */
  await connectRedis();
  await connectBullMqRedis();
  warnWhenBullMqSharesCacheRedisHost();
  setWorkerPostgresPoolDemandContext(computeWorkerPostgresPoolDemand());
  await assertPostgresConnectionBudget({ assertWorkerConcurrency: true });
  await assertDatabaseRoleRlsSafety();
  registerPostgresPoolMetrics();

  const { createWorkerContainers } = await import('@/worker-containers.js');
  const workers = await registerDomainWorkers(createWorkerContainers());
  await startWorkerHealthServer();
  markWorkerHealthReady(workers.length);

  const shutdown = async (signal: string) => {
    markWorkerHealthNotReady();
    logger.info({ signal }, 'Worker shutdown requested');
    stopRssMonitoring();

    const watchdogMs = getShutdownWatchdogMs();
    const watchdogTimer = setTimeout(() => {
      logger.error({ watchdogMs }, 'Worker shutdown timeout exceeded');
      process.exit(1);
    }, watchdogMs).unref();

    try {
      /**
       * Order matters: drain workers first so no new DB / Redis work starts, then close
       * DLQ producer queues, then shared infra (Redis, Postgres pool), and finally flush
       * telemetry.
       */
      await stopWorkerHealthServer();
      await Promise.allSettled(workers.map((workerHandle) => closeWorkerHandle(workerHandle)));
      await Promise.allSettled([
        closeDeadLetterQueues(),
        closeStripeWebhookQueue(),
        closeMailQueue(),
        closeNotificationQueue(),
        closeWebhookDeliveryQueue(),
      ]);
      await Promise.allSettled([closeRedis(), closeBullMqRedis(), closeDatabase()]);
      await flushSentry();
      clearTimeout(watchdogTimer);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Worker shutdown failed');
      clearTimeout(watchdogTimer);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info({ workerCount: workers.length }, 'Worker started');
}

main().catch((error) => {
  captureException(error, { tags: { source: 'worker_startup' } });
  logger.error({ error }, 'Worker failed to start');
  void flushSentry().finally(() => process.exit(1));
});
