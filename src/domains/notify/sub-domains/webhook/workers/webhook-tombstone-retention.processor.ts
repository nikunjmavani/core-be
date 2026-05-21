import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

export async function runWebhookTombstoneRetentionJob(
  databaseHandle: WorkerDatabaseHandle,
): Promise<{
  deletedCount: number;
  blockedCount: number;
}> {
  const retentionDays = env.TOMBSTONE_RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info(
    { retentionDays, cutoffDate: cutoffDate.toISOString() },
    'webhook-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: webhooks,
    idColumn: webhooks.id,
    whereCondition: and(isNotNull(webhooks.deleted_at), lt(webhooks.deleted_at, cutoffDate))!,
    logContext: 'webhook-tombstone-retention',
    tableLabel: 'notify.webhooks',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'webhook-tombstone-retention.completed',
  );

  return { deletedCount, blockedCount };
}
