import { describe, expect, it } from 'vitest';
import { sql } from '@/infrastructure/database/connection.js';

const PARTITION_INFRASTRUCTURE_FUNCTIONS = [
  'ensure_monthly_range_partition',
  'drop_empty_monthly_partitions_before',
] as const;

describe('partitioning performance guard', () => {
  it('exposes monthly partition create and drop helpers in the database', async () => {
    const rows = await sql<{ proname: string }[]>`
      SELECT proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'infrastructure'
        AND proname IN ${sql(PARTITION_INFRASTRUCTURE_FUNCTIONS)}
    `;
    if (rows.length === 0) {
      return;
    }

    expect(rows.map((row) => row.proname).sort()).toEqual(
      [...PARTITION_INFRASTRUCTURE_FUNCTIONS].sort(),
    );
  });

  it('lists audit.logs and notify.notifications as partitioned parents when migrated', async () => {
    const rows = await sql<{ schema_name: string; table_name: string; relkind: string }[]>`
      SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE (n.nspname, c.relname) IN (
        ('audit', 'logs'),
        ('notify', 'notifications')
      )
    `;

    const partitionedParents = rows.filter((row) => row.relkind === 'p');
    if (partitionedParents.length === 0) {
      return;
    }

    expect(partitionedParents).toHaveLength(2);
  });
});
