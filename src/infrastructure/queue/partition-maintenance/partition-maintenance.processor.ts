import { runPartitionMaintenance } from '@/infrastructure/database/partition-maintenance.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * BullMQ processor for the `partition-maintenance` queue — keeps monthly RANGE partitions
 * created ahead of time and prunes empty expired ones.
 *
 * @remarks
 * - **Algorithm:** delegates to `runPartitionMaintenance()` which first calls
 *   `ensureMonthlyPartitions()` then `dropEmptyExpiredPartitions()`, returning the count
 *   of partitions added and removed.
 * - **Failure modes:** any SQL failure propagates so BullMQ records the job as failed and
 *   the standard DLQ + Sentry pipeline (see {@link attachDeadLetterAndAlerting}) kicks in.
 * - **Side effects:** issues `CREATE TABLE ... PARTITION OF` / `DROP TABLE` DDL against
 *   the shared connection pool; emits `partition-maintenance.starting` and
 *   `partition-maintenance.completed` log lines.
 * - **Notes:** runs outside any RLS / organization context (DDL is global) and is
 *   currently event-driven only — no cron is registered for it yet, so the scheduler
 *   registry audit flags it as an orphan worker.
 */
export async function runPartitionMaintenanceJob(): Promise<{ ensured: number; dropped: number }> {
  logger.info('partition-maintenance.starting');
  const result = await runPartitionMaintenance();
  logger.info(result, 'partition-maintenance.completed');
  return result;
}
