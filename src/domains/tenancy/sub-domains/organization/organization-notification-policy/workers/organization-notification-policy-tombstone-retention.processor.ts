import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/utils/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { organization_notification_policies } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * Hard-deletes `tenancy.organization_notification_policies` rows whose
 * `deleted_at` is older than `env.TOMBSTONE_RETENTION_DAYS`.
 *
 * @remarks
 * - **Algorithm:** computes the cutoff date and delegates to
 *   `deleteInBatchesByCondition` for chunked deletion; returns counts of
 *   deleted and FK-blocked rows.
 * - **Failure modes:** Postgres errors propagate to BullMQ retry / DLQ;
 *   FK conflicts surface via `blockedCount`.
 * - **Side effects:** permanent removal of soft-deleted policy rows;
 *   structured `info` logs at start and completion.
 * - **Notes:** runs under the global retention-cleanup DB context that
 *   short-circuits the policy's tenant-isolation RLS via
 *   `app.global_retention_cleanup = 'true'`.
 */
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
