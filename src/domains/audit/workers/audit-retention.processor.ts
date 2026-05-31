import { lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/utils/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * Deletes audit log rows older than `AUDIT_RETENTION_DAYS` in tenant-agnostic
 * batches.
 *
 * @remarks
 * Compliance retention enforcement. Uses
 * {@link deleteInBatchesByCondition} so the job:
 *
 * - Holds short transactions (one batch at a time) to avoid bloating WAL and
 *   blocking writes on the hot `logs` table.
 * - Returns a `blockedCount` for any batch the lock acquisition skipped, so
 *   monitoring can alert if retention is unable to make progress (e.g. heavy
 *   ingestion, long-running queries).
 * - Uses the global retention DB role (no tenant context) — the cutoff is a
 *   straight `created_at < cutoffDate` so RLS would only get in the way.
 *
 * Idempotent: rerunning before the next event horizon is a no-op.
 */
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
