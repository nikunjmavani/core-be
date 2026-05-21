import { lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

export async function runAuditRetentionJob(databaseHandle: WorkerDatabaseHandle): Promise<{
  deletedCount: number;
  blockedCount: number;
}> {
  const retentionDays = env.AUDIT_RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info({ retentionDays, cutoffDate: cutoffDate.toISOString() }, 'audit-retention.starting');

  const { deletedCount, blockedCount } = await deleteInBatchesByCondition({
    databaseHandle,
    table: logs,
    idColumn: logs.id,
    whereCondition: lt(logs.created_at, cutoffDate),
    logContext: 'audit-retention',
    tableLabel: 'audit.logs',
  });

  logger.info({ deletedCount, blockedCount, retentionDays }, 'audit-retention.completed');

  return { deletedCount, blockedCount };
}
