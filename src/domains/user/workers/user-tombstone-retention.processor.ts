import { and, isNotNull, lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { users } from '@/domains/user/user.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

export async function runUserTombstoneRetentionJob(databaseHandle: WorkerDatabaseHandle): Promise<{
  deletedCount: number;
  blockedCount: number;
}> {
  const retentionDays = env.TOMBSTONE_RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info(
    { retentionDays, cutoffDate: cutoffDate.toISOString() },
    'user-tombstone-retention.starting',
  );

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: users,
    idColumn: users.id,
    whereCondition: and(isNotNull(users.deleted_at), lt(users.deleted_at, cutoffDate))!,
    logContext: 'user-tombstone-retention',
    tableLabel: 'auth.users',
  });

  logger.info({ deletedCount, blockedCount, retentionDays }, 'user-tombstone-retention.completed');

  return { deletedCount, blockedCount };
}
