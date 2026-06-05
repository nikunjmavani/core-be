import { lt } from 'drizzle-orm';
import { deleteInBatchesByCondition } from '@/infrastructure/database/utils/batch-delete.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { dead_letter_jobs } from '@/infrastructure/queue/dlq/dead-letter.schema.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * Deletes audit-schema operational records older than `AUDIT_RETENTION_DAYS` in
 * tenant-agnostic batches: the `audit.logs` compliance trail and the
 * `audit.dead_letter_jobs` failure ledger.
 *
 * @remarks
 * Compliance + operational retention enforcement. Uses
 * {@link deleteInBatchesByCondition} so the job:
 *
 * - Holds short transactions (one batch at a time) to avoid bloating WAL and
 *   blocking writes on the hot tables.
 * - Returns a `blockedCount` for any batch the lock acquisition skipped, so
 *   monitoring can alert if retention is unable to make progress (e.g. heavy
 *   ingestion, long-running queries).
 * - Uses the global retention DB role (no tenant context) — the cutoffs are a
 *   straight `created_at`/`failed_at < cutoffDate` so RLS would only get in the
 *   way.
 *
 * The dead-letter ledger previously had **no** retention and grew unbounded
 * (one immutable row per terminal failure, including every failed replay); it is
 * now bounded to the same window and pruned by `failed_at`.
 *
 * Idempotent: rerunning before the next event horizon is a no-op.
 */
export async function runAuditRetentionJob(databaseHandle: WorkerDatabaseHandle): Promise<{
  deletedCount: number;
  blockedCount: number;
  deadLetterDeletedCount: number;
  deadLetterBlockedCount: number;
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

  const { deletedCount: deadLetterDeletedCount, blockedCount: deadLetterBlockedCount } =
    await deleteInBatchesByCondition({
      databaseHandle,
      table: dead_letter_jobs,
      idColumn: dead_letter_jobs.id,
      whereCondition: lt(dead_letter_jobs.failed_at, cutoffDate),
      logContext: 'audit-retention.dead-letter',
      tableLabel: 'audit.dead_letter_jobs',
    });

  logger.info(
    {
      deletedCount,
      blockedCount,
      deadLetterDeletedCount,
      deadLetterBlockedCount,
      retentionDays,
    },
    'audit-retention.completed',
  );

  return { deletedCount, blockedCount, deadLetterDeletedCount, deadLetterBlockedCount };
}
