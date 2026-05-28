import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { roles } from '@/domains/tenancy/sub-domains/member-roles/member-role.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * Hard-deletes role rows whose `deleted_at` is older than
 * `env.TOMBSTONE_RETENTION_DAYS` so soft-deleted roles eventually leave the
 * database.
 *
 * @remarks
 * - **Algorithm:** computes a cutoff `now - retentionDays`, then calls
 *   {@link deleteInBatchesByCondition} on `tenancy.roles` matching
 *   `deleted_at IS NOT NULL AND deleted_at < cutoff`.
 * - **Failure modes:** rows still referenced by FK constraints surface as the
 *   `blockedCount` return (the helper swallows FK violations and continues);
 *   any other database error bubbles to BullMQ for retry.
 * - **Side effects:** issues DELETE batches against `tenancy.roles`; child
 *   `tenancy.role_permissions` rows cascade automatically via
 *   `ON DELETE CASCADE`.
 * - **Notes:** intended to run under the global retention cleanup context,
 *   which bypasses tenant RLS via `app.global_retention_cleanup = 'true'`.
 *   Returned counts are logged for observability.
 */
export async function runMemberRoleTombstoneRetentionJob(
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
    'member-role-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: roles,
    idColumn: roles.id,
    whereCondition: and(isNotNull(roles.deleted_at), lt(roles.deleted_at, cutoffDate))!,
    logContext: 'member-role-tombstone-retention',
    tableLabel: 'tenancy.roles',
  });

  logger.info(
    { deletedCount, blockedCount, retentionDays },
    'member-role-tombstone-retention.completed',
  );

  return { deletedCount, blockedCount };
}
