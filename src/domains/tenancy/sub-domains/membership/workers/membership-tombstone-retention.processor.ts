import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

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
