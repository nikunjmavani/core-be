import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { retrieveStripeEvent } from '@/infrastructure/payment/stripe.client.js';
import type { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type { StripeWebhookJobData } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { stripeWebhookJobDataSchema } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.job.schema.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

/**
 * Worker entry point for jobs on the `stripe-webhook` queue: revalidates the
 * minimal Redis payload, refetches the full event from Stripe by id, and
 * delegates to {@link StripeWebhookService.handleEvent} for idempotent
 * processing.
 *
 * @remarks
 * - **Algorithm:** Only the `stripeEventId` is persisted in Redis, so the
 *   processor reaches back to Stripe via {@link retrieveStripeEvent} to obtain
 *   the verified canonical event before invoking the service. The service then
 *   owns ledger claim, organization context, and dispatch.
 * - **Failure modes:** Schema validation errors are surfaced via
 *   {@link parseBullMQJobData}. Stripe API failures and service errors
 *   propagate so BullMQ honours its retry/backoff (`stripeWebhookBackoffStrategy`).
 * - **Side effects:** One Stripe API call per attempt; downstream service may
 *   write to ledger and subscription tables.
 * - **Notes:** Re-fetching keeps Redis payloads small and ensures every retry
 *   sees the current Stripe representation of the event.
 */
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
