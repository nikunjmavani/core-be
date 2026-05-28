import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { enqueueStripeWebhookByEventId } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import { setStripeWebhookEventsFailedCount } from '@/infrastructure/observability/metrics/prometheus-metrics.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

export type StripeWebhookEventReclaimJobResult = {
  scannedCount: number;
  reclaimedCount: number;
  enqueuedCount: number;
};

/**
 * Reclaims failed or stuck-processing ledger rows and re-enqueues stripe-webhook jobs.
 */
export async function runStripeWebhookEventReclaimJob(
  repository: StripeWebhookEventRepository = new StripeWebhookEventRepository(),
): Promise<StripeWebhookEventReclaimJobResult> {
  return withSystemTableWorkerContext(() => runStripeWebhookEventReclaimJobInner(repository));
}

async function runStripeWebhookEventReclaimJobInner(
  repository: StripeWebhookEventRepository,
): Promise<StripeWebhookEventReclaimJobResult> {
  const batchSize = env.STRIPE_WEBHOOK_EVENT_RECLAIM_BATCH_SIZE;
  const { scannedCount, reclaimedCount, reclaimedStripeEventIds } =
    await repository.sweepReclaimableEvents(batchSize);

  let enqueuedCount = 0;
  for (const stripeEventId of reclaimedStripeEventIds) {
    try {
      await enqueueStripeWebhookByEventId(stripeEventId, 'stripe-webhook-event-reclaim');
      enqueuedCount += 1;
    } catch (error) {
      logger.warn({ error, stripeEventId }, 'stripe-webhook-event-reclaim.enqueue.failed');
    }
  }

  const failedCount = await repository.countFailedEvents();
  setStripeWebhookEventsFailedCount(failedCount);

  logger.info(
    { scannedCount, reclaimedCount, enqueuedCount, failedCount },
    'stripe-webhook-event-reclaim.completed',
  );

  return { scannedCount, reclaimedCount, enqueuedCount };
}
