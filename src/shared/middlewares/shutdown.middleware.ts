import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { closeBullMqRedis } from '@/infrastructure/cache/bullmq-redis.client.js';
import { closeRedis } from '@/infrastructure/cache/redis.client.js';
import { closeMailQueue } from '@/infrastructure/mail/queues/mail.queue.js';
import { closeNotificationQueue } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { closeWebhookDeliveryQueue } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { flushSentry } from '@/infrastructure/observability/sentry/sentry.js';
import { setApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

import { getShutdownWatchdogMs } from '@/infrastructure/queue/worker-runtime/shutdown-timing.util.js';

const shutdownMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onClose', async () => {
    /**
     * Order: stop accepting jobs (producer queues) → close shared infra (Redis, DB) →
     * flush telemetry. Each close is independent of the others and is awaited via
     * allSettled so a slow Redis does not abort the DB drain.
     */
    await Promise.allSettled([
      closeMailQueue(),
      closeNotificationQueue(),
      closeWebhookDeliveryQueue(),
    ]);
    await Promise.allSettled([closeRedis(), closeBullMqRedis(), closeDatabase()]);
    await flushSentry();
  });

  const shutdown = async (signal: string) => {
    setApplicationDraining(true);
    logger.info({ signal }, 'Shutdown requested');

    const watchdogMs = getShutdownWatchdogMs();
    const timer = setTimeout(() => {
      logger.error({ watchdogMs }, 'Shutdown timeout exceeded');
      process.exit(1);
    }, watchdogMs).unref();

    try {
      await app.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Shutdown failed');
      clearTimeout(timer);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

export default fp(shutdownMiddleware, { name: 'shutdown-middleware' });
