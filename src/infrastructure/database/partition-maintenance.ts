import { sql } from '@/infrastructure/database/connection.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const PARTITIONED_TABLES = [
  { schema: 'audit', table: 'logs', column: 'created_at' },
  { schema: 'notify', table: 'notifications', column: 'created_at' },
] as const;

/** Parents whose empty child partitions are dropped after row-level retention. */
const PARTITION_DROP_TARGETS = [
  { schema: 'audit', table: 'logs', retentionDays: () => env.AUDIT_RETENTION_DAYS },
  {
    schema: 'notify',
    table: 'notifications',
    retentionDays: () => env.NOTIFICATION_RETENTION_DAYS,
  },
] as const;

/**
 * Ensures current and next-month child partitions exist for partitioned parents.
 */
export async function ensureMonthlyPartitions(): Promise<{ ensured: number }> {
  const now = new Date();
  const monthStarts = [
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  ];

  let ensured = 0;

  for (const { schema, table, column } of PARTITIONED_TABLES) {
    for (const monthStart of monthStarts) {
      await sql`
        SELECT infrastructure.ensure_monthly_range_partition(
          ${schema},
          ${table},
          ${column},
          ${monthStart.toISOString()}::timestamptz
        )
      `;
      ensured += 1;
      logger.info(
        { schema, table, monthStart: monthStart.toISOString() },
        'partition-maintenance.ensured',
      );
    }
  }

  return { ensured };
}

/**
 * Drops empty monthly child partitions wholly before the retention cutoff.
 * Run after daily audit/notification retention has deleted rows in those partitions.
 */
export async function dropEmptyExpiredPartitions(): Promise<{ dropped: number }> {
  let dropped = 0;

  for (const { schema, table, retentionDays } of PARTITION_DROP_TARGETS) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays());

    const rows = await sql<{ dropped: number }[]>`
      SELECT infrastructure.drop_empty_monthly_partitions_before(
        ${schema},
        ${table},
        ${cutoffDate.toISOString()}::timestamptz
      ) AS dropped
    `;

    const partitionDropCount = Number(rows[0]?.dropped ?? 0);
    dropped += partitionDropCount;

    if (partitionDropCount > 0) {
      logger.info(
        { schema, table, dropped: partitionDropCount, cutoffDate: cutoffDate.toISOString() },
        'partition-maintenance.dropped',
      );
    }
  }

  return { dropped };
}

export async function runPartitionMaintenance(): Promise<{ ensured: number; dropped: number }> {
  const { ensured } = await ensureMonthlyPartitions();
  const { dropped } = await dropEmptyExpiredPartitions();
  return { ensured, dropped };
}
