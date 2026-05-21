import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { organization_notification_policies } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

export async function runOrganizationNotificationPolicyTombstoneRetentionJob(
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
    'organization-notification-policy-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: organization_notification_policies,
    idColumn: organization_notification_policies.id,
    whereCondition: and(
      isNotNull(organization_notification_policies.deleted_at),
      lt(organization_notification_policies.deleted_at, cutoffDate),
    )!,
    logContext: 'organization-notification-policy-tombstone-retention',
    tableLabel: 'tenancy.organization_notification_policies',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'organization-notification-policy-tombstone-retention.completed',
  );

  return { deletedCount, blockedCount };
}
