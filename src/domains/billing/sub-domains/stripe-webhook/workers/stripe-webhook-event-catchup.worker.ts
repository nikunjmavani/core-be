import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runStripeWebhookEventCatchupJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.processor.js';
import { STRIPE_WEBHOOK_EVENT_CATCHUP_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Polls Stripe `events.list` for a recent window and re-ingests events missing from the local ledger
 * so deliveries dropped while the API was down (beyond the signature-tolerance window) are recovered.
 *
 * @remarks
 * - **Algorithm:** creates a single BullMQ {@link Worker} for the catch-up queue that delegates each
 *   job to {@link runStripeWebhookEventCatchupJob}. The processor lists recent Stripe events, diffs
 *   them against the ledger, and enqueues the missing ids onto the `stripe-webhook` queue.
 * - **Failure modes:** stalled jobs are logged via the `stalled` listener; processor errors fall back
 *   to BullMQ's default retry/backoff for the catch-up queue. No-ops when Stripe is not configured.
 * - **Side effects:** holds a Redis worker connection until the returned {@link WorkerHandle} is closed.
 * - **Notes:** schedule cadence and concurrency live in `src/infrastructure/queue/scheduler.ts` and
 *   `worker-runtime/worker-options.ts` (retention worker tier).
 */
export function createStripeWebhookEventCatchupWorker(): WorkerHandle {
  const worker = new Worker(
    STRIPE_WEBHOOK_EVENT_CATCHUP_QUEUE_NAME,
    async () => runStripeWebhookEventCatchupJob(),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: STRIPE_WEBHOOK_EVENT_CATCHUP_QUEUE_NAME },
      'stripe-webhook-event-catchup.stalled',
    );
  });

  return buildWorkerHandle(worker, STRIPE_WEBHOOK_EVENT_CATCHUP_QUEUE_NAME);
}
