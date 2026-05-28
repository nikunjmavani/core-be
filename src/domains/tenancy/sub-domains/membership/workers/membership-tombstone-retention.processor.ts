import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * Hard-deletes `tenancy.memberships` rows whose `deleted_at` is older than
 * `env.TOMBSTONE_RETENTION_DAYS`, freeing the soft-deleted records that have
 * passed the retention window.
 *
 * @remarks
 * - **Algorithm:** computes a cutoff `now - retentionDays`, then calls
 *   {@link deleteInBatchesByCondition} on `tenancy.memberships` matching
 *   `deleted_at IS NOT NULL AND deleted_at < cutoff`.
 * - **Failure modes:** rows still referenced by other tables surface as the
 *   `blockedCount` return; any other database error bubbles up so BullMQ can
 *   retry.
 * - **Side effects:** issues DELETE batches against `tenancy.memberships`;
 *   child `tenancy.member_invitations` rows cascade automatically via
 *   `ON DELETE CASCADE`.
 * - **Notes:** must run under the global retention cleanup context which
 *   sets `app.global_retention_cleanup = 'true'` so RLS is bypassed.
 */
export async function runMembershipTombstoneRetentionJob(
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
    'membership-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: memberships,
    idColumn: memberships.id,
    whereCondition: and(isNotNull(memberships.deleted_at), lt(memberships.deleted_at, cutoffDate))!,
    logContext: 'membership-tombstone-retention',
    tableLabel: 'tenancy.memberships',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'membership-tombstone-retention.completed',
  );

  return { deletedCount, blockedCount };
}
