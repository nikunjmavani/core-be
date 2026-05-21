import { Queue } from 'bullmq';
import type Stripe from 'stripe';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import {
  stripeWebhookJobDataSchema,
  type StripeWebhookJobDataValidated,
} from './stripe-webhook.job.schema.js';

export const STRIPE_WEBHOOK_QUEUE_NAME = 'stripe-webhook';

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

export async function enqueueStripeWebhook(event: Stripe.Event, requestId?: string): Promise<void> {
  await enqueueStripeWebhookByEventId(event.id, requestId);
}

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

export async function closeStripeWebhookQueue(): Promise<void> {
  if (stripeWebhookQueue) {
    await stripeWebhookQueue.close();
    stripeWebhookQueue = null;
  }
}
