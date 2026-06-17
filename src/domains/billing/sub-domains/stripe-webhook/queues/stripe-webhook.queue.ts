import { Queue } from 'bullmq';
import type Stripe from 'stripe';
import { getBullMQProducerConnectionOptions } from '@/infrastructure/queue/connection.js';
import { DEFAULT_JOB_RETENTION_COUNT } from '@/infrastructure/queue/queue.constants.js';
import { captureTraceContextForPropagation } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { SEVEN_DAYS_SECONDS } from '@/shared/constants/ttl.constants.js';
import {
  stripeWebhookJobDataSchema,
  type StripeWebhookJobDataValidated,
} from './stripe-webhook.job.schema.js';

/** BullMQ queue name for asynchronous Stripe webhook event processing. */
export const STRIPE_WEBHOOK_QUEUE_NAME = 'stripe-webhook';

/** Public alias for the validated job payload shape on the `stripe-webhook` queue. */
export type StripeWebhookJobData = StripeWebhookJobDataValidated;

let stripeWebhookQueue: Queue<StripeWebhookJobData> | null = null;

function getStripeWebhookQueue(): Queue<StripeWebhookJobData> {
  if (stripeWebhookQueue) return stripeWebhookQueue;
  stripeWebhookQueue = new Queue<StripeWebhookJobData>(STRIPE_WEBHOOK_QUEUE_NAME, {
    connection: getBullMQProducerConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: DEFAULT_JOB_RETENTION_COUNT, age: SEVEN_DAYS_SECONDS },
      removeOnFail: { count: DEFAULT_JOB_RETENTION_COUNT, age: SEVEN_DAYS_SECONDS },
      attempts: 5,
      backoff: { type: 'custom' },
    },
  });
  return stripeWebhookQueue;
}

/**
 * Convenience wrapper that enqueues a verified Stripe event by id; the worker
 * re-fetches the full event from Stripe so only the id is persisted in Redis.
 */
export async function enqueueStripeWebhook(event: Stripe.Event, requestId?: string): Promise<void> {
  await enqueueStripeWebhookByEventId(event.id, requestId);
}

/**
 * Enqueues a `stripe-webhook` job keyed by `stripe-event-${stripeEventId}` so
 * BullMQ deduplicates concurrent deliveries of the same Stripe event id.
 */
export async function enqueueStripeWebhookByEventId(
  stripeEventId: string,
  requestId?: string,
): Promise<void> {
  const queue = getStripeWebhookQueue();
  const jobData = parseBullMQJobData(
    stripeWebhookJobDataSchema,
    omitUndefined({
      stripeEventId,
      requestId,
      ...captureTraceContextForPropagation(),
    }),
    STRIPE_WEBHOOK_QUEUE_NAME,
  );
  await queue.add('process-stripe-webhook', jobData, {
    jobId: `stripe-event-${stripeEventId}`,
  });
}

/**
 * Enqueues a `stripe-webhook` job for the cron-driven reclaim sweep with a
 * fresh, attempt-unique jobId so BullMQ's seven-day failed-job retention
 * (sec-Q #1) does not silently no-op the re-enqueue via the Lua duplicate-jobId
 * path.
 *
 * @remarks
 * - **sec-re-02:** The HTTP ingress path keeps using
 *   {@link enqueueStripeWebhookByEventId} (jobId `stripe-event-${id}`) so
 *   concurrent webhook deliveries deduplicate. The reclaim path needs the
 *   opposite — every sweep must produce a job BullMQ has not seen before so
 *   the worker actually receives it. We append the current epoch milliseconds
 *   to the jobId; two sweeps in the same millisecond for the same event id
 *   would still dedup, but downstream `tryClaimEvent` is atomic on the ledger
 *   row so duplicate dispatches are safe (the second hits
 *   `still_processing_within_lease` and exits).
 * - **Failure modes:** propagates BullMQ enqueue errors so the caller can log
 *   and skip.
 * - **Side effects:** writes a new job to the `stripe-webhook` queue.
 */
export async function enqueueStripeWebhookByEventIdForReclaim(
  stripeEventId: string,
  requestId?: string,
): Promise<void> {
  const queue = getStripeWebhookQueue();
  const jobData = parseBullMQJobData(
    stripeWebhookJobDataSchema,
    omitUndefined({
      stripeEventId,
      requestId,
      ...captureTraceContextForPropagation(),
    }),
    STRIPE_WEBHOOK_QUEUE_NAME,
  );
  await queue.add('process-stripe-webhook', jobData, {
    jobId: `stripe-event-${stripeEventId}-reclaim-${Date.now()}`,
  });
}

/** Closes and disposes the singleton queue connection during graceful shutdown. */
export async function closeStripeWebhookQueue(): Promise<void> {
  if (stripeWebhookQueue) {
    await stripeWebhookQueue.close();
    stripeWebhookQueue = null;
  }
}
