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
 * Sweeps failed or stuck-processing Stripe webhook ledger rows and re-enqueues
 * follow-up jobs so abandoned deliveries get retried.
 *
 * @remarks
 * - **Algorithm:** Creates a single BullMQ {@link Worker} for the reclaim queue
 *   that delegates each job to {@link runStripeWebhookEventReclaimJob}. The
 *   processor performs the actual lock flip
 *   (`failed` → `processing` or `processing` past lease → `processing`) and
 *   the requeue.
 * - **Failure modes:** Stalled jobs are logged via the `stalled` listener;
 *   processor errors fall back to BullMQ's default retry/backoff for the
 *   reclaim queue.
 * - **Side effects:** Holds a Redis worker connection until the returned
 *   {@link WorkerHandle} is closed during shutdown.
 * - **Notes:** Schedule cadence and concurrency live in
 *   `src/infrastructure/queue/scheduler.ts` and
 *   `worker-runtime/worker-options.ts` (retention worker tier).
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
