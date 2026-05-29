/**
 * Single source of truth for the RANGE-partitioned parent tables in the
 * platform. These are append-heavy tables whose monthly child partitions are
 * created and dropped by the partition-maintenance worker.
 *
 * Consumed by `partition-maintenance.ts` (which child partitions to ensure /
 * drop) and by the migration linter (`pnpm db:migrate:lint`), which forbids
 * `CREATE INDEX CONCURRENTLY` against a partitioned parent — PostgreSQL rejects
 * it (`cannot create index on partitioned table ... concurrently`). Index a
 * partitioned parent with a plain recursive `CREATE INDEX`, or build per-child
 * `CREATE INDEX CONCURRENTLY` + `ATTACH PARTITION` operationally.
 */

/** A RANGE-partitioned parent table and the column its partitions range over. */
export interface PartitionedTableReference {
  schema: string;
  table: string;
  column: string;
}

/** Every RANGE-partitioned parent table in the platform. */
export const PARTITIONED_TABLES: readonly PartitionedTableReference[] = [
  { schema: 'audit', table: 'logs', column: 'created_at' },
  { schema: 'notify', table: 'notifications', column: 'created_at' },
] as const;

/**
 * Whether `table` (optionally schema-qualified) is a partitioned parent. When
 * `schema` is omitted, matches on the table name alone — used by the linter,
 * whose parsed `ON` target may be unqualified.
 */
export function isPartitionedTable({
  schema,
  table,
}: {
  schema?: string | null;
  table: string;
}): boolean {
  return PARTITIONED_TABLES.some(
    (partitioned) =>
      partitioned.table === table && (schema == null || partitioned.schema === schema),
  );
}
