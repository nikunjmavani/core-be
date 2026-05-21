import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import {
  webhookDeliveryJobDataSchema,
  type WebhookDeliveryJobDataValidated,
} from './webhook-delivery.job.schema.js';

export const WEBHOOK_DELIVERY_QUEUE_NAME = 'webhook-delivery';

/** Delivery attempt id and org scope are stored in Redis; payload and secrets live in Postgres. */
export type WebhookDeliveryJobData = WebhookDeliveryJobDataValidated;

let webhookDeliveryQueue: Queue<WebhookDeliveryJobData> | null = null;

function getWebhookDeliveryQueue(): Queue<WebhookDeliveryJobData> {
  if (webhookDeliveryQueue) return webhookDeliveryQueue;
  webhookDeliveryQueue = new Queue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE_NAME, {
    connection: getBullMQConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 5000 },
      attempts: 5,
      backoff: { type: 'custom' },
    },
  });
  return webhookDeliveryQueue;
}

/**
 * Enqueue delivery for an existing attempt row (payload loaded in worker from Postgres).
 * Called from notify event handlers only.
 */
export async function enqueueWebhookDeliveryByAttemptId(
  deliveryAttemptId: number,
  organizationPublicId: string,
  requestId?: string,
): Promise<void> {
  const queue = getWebhookDeliveryQueue();
  const jobData = parseBullMQJobData(
    webhookDeliveryJobDataSchema,
    { deliveryAttemptId, organizationPublicId, requestId },
    WEBHOOK_DELIVERY_QUEUE_NAME,
  );
  await queue.add('deliver-webhook', jobData, {
    jobId: `wh-attempt-${String(deliveryAttemptId)}`,
  });
}

export async function closeWebhookDeliveryQueue(): Promise<void> {
  if (webhookDeliveryQueue) {
    await webhookDeliveryQueue.close();
    webhookDeliveryQueue = null;
  }
}
