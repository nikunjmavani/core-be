import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { enqueueStripeWebhookByEventId } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';
import { setStripeWebhookEventsFailedCount } from '@/infrastructure/observability/metrics/prometheus-metrics.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Per-run counters returned by {@link runStripeWebhookEventReclaimJob}:
 * `scannedCount` is the number of candidate ledger rows inspected,
 * `reclaimedCount` is how many were successfully flipped back to `processing`,
 * and `enqueuedCount` is how many follow-up `stripe-webhook` jobs were created.
 *
 * @remarks
 * - **Algorithm:** Populated by counting rows from the repository sweep.
 * - **Failure modes:** Re-enqueue failures decrement `enqueuedCount` but do not
 *   roll back the reclaim — the row stays in `processing` for the next sweep.
 * - **Side effects:** None — this is a plain data type.
 * - **Notes:** Useful for metrics / log assertions in tests.
 */
export type StripeWebhookEventReclaimJobResult = {
  scannedCount: number;
  reclaimedCount: number;
  enqueuedCount: number;
};

/**
 * Sweeps the Stripe webhook ledger for events that were left in `failed` or
 * stale-`processing` state and re-enqueues fresh jobs so the BullMQ worker can
 * retry them.
 *
 * @remarks
 * - **Algorithm:** Within {@link withSystemTableWorkerContext}, asks
 *   {@link StripeWebhookEventRepository.sweepReclaimableEvents} for up to
 *   `env.STRIPE_WEBHOOK_EVENT_RECLAIM_BATCH_SIZE` candidates. The lock
 *   semantics are an optimistic flip: each row is updated only if it is still
 *   `failed` or has been `processing` longer than
 *   `STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES`, atomically bumping
 *   `attempt_count` and clearing `failure_reason`/`processed_at`. Reclaimed
 *   ids are then re-enqueued by event id, relying on the queue's
 *   `stripe-event-${id}` jobId for dedup.
 * - **Failure modes:** Individual re-enqueue errors are logged and skipped so a
 *   single bad event does not block the rest of the batch. The repository
 *   methods are themselves idempotent.
 * - **Side effects:** Updates `billing.stripe_webhook_events` rows, enqueues
 *   BullMQ jobs on the `stripe-webhook` queue, and refreshes the
 *   `stripe_webhook_events_failed_count` Prometheus gauge.
 * - **Notes:** Driven by the repeatable scheduler registered in
 *   `src/infrastructure/queue/scheduler.ts`; the parameter is injectable for
 *   tests.
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
