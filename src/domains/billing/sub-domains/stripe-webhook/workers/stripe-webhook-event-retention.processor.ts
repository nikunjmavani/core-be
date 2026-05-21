import { and, inArray, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { stripe_webhook_events } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

export async function runStripeWebhookEventRetentionJob(
  databaseHandle: WorkerDatabaseHandle,
): Promise<{
  deletedCount: number;
  blockedCount: number;
}> {
  const retentionDays = env.STRIPE_WEBHOOK_EVENT_RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info(
    { retentionDays, cutoffDate: cutoffDate.toISOString() },
    'stripe-webhook-event-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: stripe_webhook_events,
    idColumn: stripe_webhook_events.stripe_event_id,
    whereCondition: and(
      inArray(stripe_webhook_events.processing_status, ['processed', 'skipped_duplicate']),
      lt(stripe_webhook_events.updated_at, cutoffDate),
    )!,
    logContext: 'stripe-webhook-event-retention',
    tableLabel: 'billing.stripe_webhook_events',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'stripe-webhook-event-retention.completed',
  );

  return { deletedCount, blockedCount };
}
