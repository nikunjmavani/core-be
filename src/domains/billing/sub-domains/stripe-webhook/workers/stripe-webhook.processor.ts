import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { retrieveStripeEvent } from '@/infrastructure/payment/stripe.client.js';
import type { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type { StripeWebhookJobData } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { stripeWebhookJobDataSchema } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.job.schema.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

export async function processStripeWebhookJob(
  jobData: StripeWebhookJobData,
  stripeWebhookService: StripeWebhookService,
  jobId?: string,
): Promise<void> {
  const parsed = parseBullMQJobData(stripeWebhookJobDataSchema, jobData, STRIPE_WEBHOOK_QUEUE_NAME);
  const { stripeEventId, requestId } = parsed;

  const eventPayload = await retrieveStripeEvent(stripeEventId);

  logger.info(
    { jobId, stripeEventId, eventType: eventPayload.type, requestId },
    'stripe.webhook.worker.processing',
  );

  await stripeWebhookService.handleEvent(eventPayload, omitUndefined({ requestId }));
}
