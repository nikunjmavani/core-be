import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/utils/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * Hard-deletes `tenancy.organizations` rows whose `deleted_at` is older than
 * `env.TOMBSTONE_RETENTION_DAYS`.
 *
 * @remarks
 * - **Algorithm:** computes the cutoff date, then calls
 *   `deleteInBatchesByCondition` to delete in chunks; child rows are removed
 *   via `ON DELETE CASCADE` on referencing tenancy tables.
 * - **Failure modes:** propagates Postgres errors (FK violations from non-
 *   cascading tables raise `blockedCount`); job retries are governed by the
 *   BullMQ worker options.
 * - **Side effects:** permanent data loss for matching rows, plus structured
 *   `info` logs at start and completion.
 * - **Notes:** runs under the global retention-cleanup DB context that
 *   bypasses RLS via `app.global_retention_cleanup = 'true'`.
 */
export async function runOrganizationTombstoneRetentionJob(
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
    'organization-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: organizations,
    idColumn: organizations.id,
    whereCondition: and(
      isNotNull(organizations.deleted_at),
      lt(organizations.deleted_at, cutoffDate),
    )!,
    logContext: 'organization-tombstone-retention',
    tableLabel: 'tenancy.organizations',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'organization-tombstone-retention.completed',
  );

  return { deletedCount, blockedCount };
}
