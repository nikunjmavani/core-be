import { sql } from '@/infrastructure/database/connection.js';

function formatAuditLogPartitionName(timestamp: Date): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  return `logs_${year}_${month}`;
}

function formatAuditLogPartitionRange(timestamp: Date): { rangeFrom: string; rangeTo: string } {
  const year = timestamp.getUTCFullYear();
  const monthIndex = timestamp.getUTCMonth();
  const rangeFrom = new Date(Date.UTC(year, monthIndex, 1)).toISOString();
  const rangeTo = new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString();
  return { rangeFrom, rangeTo };
}

/**
 * Creates the monthly `audit.logs` child partition for `timestamp` when the parent table
 * is range-partitioned on `created_at`. No-op on plain (non-partitioned) tables so the same
 * tests run against both migration-only and partitioned dev databases.
 */
export async function ensureAuditLogPartitionForTimestamp(timestamp: Date): Promise<void> {
  const kindRows = await sql<{ relkind: string }[]>`
    SELECT c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'audit' AND c.relname = 'logs'
  `;
  if (kindRows[0]?.relkind !== 'p') {
    return;
  }

  const partitionName = formatAuditLogPartitionName(timestamp);
  const { rangeFrom, rangeTo } = formatAuditLogPartitionRange(timestamp);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS audit.${partitionName}
    PARTITION OF audit.logs
    FOR VALUES FROM ('${rangeFrom}') TO ('${rangeTo}')
  `);
}

/** Ensures one partition per distinct UTC month covered by the given timestamps. */
export async function ensureAuditLogPartitionsForTimestamps(
  timestamps: readonly Date[],
): Promise<void> {
  const timestampsByPartitionName = new Map<string, Date>();
  for (const timestamp of timestamps) {
    timestampsByPartitionName.set(formatAuditLogPartitionName(timestamp), timestamp);
  }
  for (const timestamp of timestampsByPartitionName.values()) {
    await ensureAuditLogPartitionForTimestamp(timestamp);
  }
}
