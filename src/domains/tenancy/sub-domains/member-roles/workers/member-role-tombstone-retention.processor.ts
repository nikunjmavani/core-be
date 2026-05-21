import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { roles } from '@/domains/tenancy/sub-domains/member-roles/member-role.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

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
