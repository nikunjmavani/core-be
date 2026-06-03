import { Queue } from 'bullmq';
import { getBullMQProducerConnectionOptions } from '@/infrastructure/queue/connection.js';
import { captureTraceContextForPropagation } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import {
  webhookDeliveryJobDataSchema,
  type WebhookDeliveryJobDataValidated,
} from './webhook-delivery.job.schema.js';

/** BullMQ queue name for outbound webhook delivery (HMAC-signed POSTs to customer URLs). */
export const WEBHOOK_DELIVERY_QUEUE_NAME = 'webhook-delivery';

/** Total BullMQ job attempts (initial + retries). Worker derives its final-attempt guard from this. */
export const WEBHOOK_DELIVERY_JOB_ATTEMPTS = 5;

/** Delivery attempt id and org scope are stored in Redis; payload and secrets live in Postgres. */
export type WebhookDeliveryJobData = WebhookDeliveryJobDataValidated;

let webhookDeliveryQueue: Queue<WebhookDeliveryJobData> | null = null;

function getWebhookDeliveryQueue(): Queue<WebhookDeliveryJobData> {
  if (webhookDeliveryQueue) return webhookDeliveryQueue;
  webhookDeliveryQueue = new Queue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE_NAME, {
    connection: getBullMQProducerConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 5000 },
      attempts: WEBHOOK_DELIVERY_JOB_ATTEMPTS,
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
    omitUndefined({
      deliveryAttemptId,
      organizationPublicId,
      requestId,
      ...captureTraceContextForPropagation(),
    }),
    WEBHOOK_DELIVERY_QUEUE_NAME,
  );
  await queue.add('deliver-webhook', jobData, {
    jobId: `wh-attempt-${String(deliveryAttemptId)}`,
  });
}

/** Close the lazily-initialised webhook-delivery queue (graceful-shutdown hook for tests/runtime). */
export async function closeWebhookDeliveryQueue(): Promise<void> {
  if (webhookDeliveryQueue) {
    await webhookDeliveryQueue.close();
    webhookDeliveryQueue = null;
  }
}
