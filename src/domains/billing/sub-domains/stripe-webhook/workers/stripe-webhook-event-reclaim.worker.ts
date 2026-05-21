import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runStripeWebhookEventReclaimJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.processor.js';
import { STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Sweeps failed or stuck-processing Stripe webhook ledger rows and re-enqueues jobs.
 * Repeatable schedule: `src/infrastructure/queue/scheduler.ts`.
 */
export function createStripeWebhookEventReclaimWorker(): WorkerHandle {
  const worker = new Worker(
    STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME,
    async () => runStripeWebhookEventReclaimJob(),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME },
      'stripe-webhook-event-reclaim.stalled',
    );
  });

  return buildWorkerHandle(worker, STRIPE_WEBHOOK_EVENT_RECLAIM_QUEUE_NAME);
}
