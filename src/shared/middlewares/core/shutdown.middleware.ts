import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '@/shared/config/env.config.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { closeBullMqRedis } from '@/infrastructure/cache/bullmq-redis.client.js';
import { closeRedis } from '@/infrastructure/cache/redis.client.js';
import { closeMailQueue } from '@/infrastructure/mail/queues/mail.queue.js';
import { closeNotificationQueue } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { closeWebhookDeliveryQueue } from '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js';
import { closeSubscriptionSeatSyncQueue } from '@/domains/billing/sub-domains/subscription/queues/subscription-seat-sync.queue.js';
import { flushSentry } from '@/infrastructure/observability/sentry/sentry.js';
import { THREE_SECONDS_MS } from '@/shared/constants/index.js';
import { setApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

import { getShutdownWatchdogMs } from '@/infrastructure/queue/worker-runtime/shutdown-timing.util.js';

/**
 * Pause between flipping `/readyz` to 503 (draining) and closing the server, so an
 * external load balancer observes the unhealthy state on its next probe and stops
 * routing new connections before sockets close.
 *
 * @remarks
 * Sized at roughly 1.5–2× a typical 1.5–2s load-balancer health-probe interval so at
 * least one probe reliably lands inside the draining window. Without this pause a
 * Railway/LB redeploy (SIGTERM) races `app.close()`: `/readyz` only reports 503 once
 * the LB next polls, and any traffic sent in between resets → connection errors / 502s
 * on every deploy. The delay is added on top of the shutdown watchdog budget (see
 * {@link getShutdownDrainDelayMs}) so it never eats into the in-flight drain budget or
 * trips the force-exit watchdog.
 */
export const SHUTDOWN_DRAIN_DELAY_MS = THREE_SECONDS_MS;

/**
 * Runtimes that sit behind a load balancer and therefore need the pre-close drain pause.
 * Local/development/test processes are reached directly, so the delay is skipped to keep
 * shutdowns (and test suites) fast.
 */
const ENVIRONMENTS_BEHIND_LOAD_BALANCER = new Set(['staging', 'production']);

/** Drain pause for the current runtime: {@link SHUTDOWN_DRAIN_DELAY_MS} behind a load balancer, otherwise 0. */
function getShutdownDrainDelayMs(): number {
  return ENVIRONMENTS_BEHIND_LOAD_BALANCER.has(env.NODE_ENV) ? SHUTDOWN_DRAIN_DELAY_MS : 0;
}

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
      // REQ-4: producer queue used by change-plan + member add/remove on the request path.
      closeSubscriptionSeatSyncQueue(),
    ]);
    await Promise.allSettled([closeRedis(), closeBullMqRedis(), closeDatabase()]);
    await flushSentry();
  });

  const shutdown = async (signal: string) => {
    setApplicationDraining(true);
    logger.info({ signal }, 'Shutdown requested');

    const drainDelayMs = getShutdownDrainDelayMs();
    /** Add the drain pause on top of the close budget so the watchdog cannot kill the drain. */
    const watchdogMs = getShutdownWatchdogMs() + drainDelayMs;
    const timer = setTimeout(() => {
      logger.error({ watchdogMs }, 'Shutdown timeout exceeded');
      process.exit(1);
    }, watchdogMs).unref();

    try {
      if (drainDelayMs > 0) {
        logger.info({ drainDelayMs }, 'Draining: waiting for load balancer to observe 503');
        await new Promise<void>((resolve) => setTimeout(resolve, drainDelayMs).unref());
      }
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
