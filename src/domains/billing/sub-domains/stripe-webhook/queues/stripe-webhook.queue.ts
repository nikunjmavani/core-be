import { Queue } from 'bullmq';
import type Stripe from 'stripe';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
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
    connection: getBullMQConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 5000 },
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
    }),
    STRIPE_WEBHOOK_QUEUE_NAME,
  );
  await queue.add('process-stripe-webhook', jobData, {
    jobId: `stripe-event-${stripeEventId}`,
  });
}

/** Closes and disposes the singleton queue connection during graceful shutdown. */
export async function closeStripeWebhookQueue(): Promise<void> {
  if (stripeWebhookQueue) {
    await stripeWebhookQueue.close();
    stripeWebhookQueue = null;
  }
}
