import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.constants.js';
import { runStripeWebhookEventRetentionJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.processor.js';
import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Purges terminal Stripe webhook ledger rows older than STRIPE_WEBHOOK_EVENT_RETENTION_DAYS.
 * Failed / in-flight rows are retained for replay and ops.
 * Repeatable schedule is registered in `src/infrastructure/queue/scheduler.ts`.
 */
export function createStripeWebhookEventRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME,
    async () =>
      withSystemTableWorkerContext((databaseHandle) =>
        runStripeWebhookEventRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME },
      'stripe-webhook-event-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, STRIPE_WEBHOOK_EVENT_RETENTION_QUEUE_NAME);
}
