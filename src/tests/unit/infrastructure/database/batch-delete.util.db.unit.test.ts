import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql as drizzleSql } from 'drizzle-orm';
import { bigint, pgTable } from 'drizzle-orm/pg-core';
import { sql } from '@/infrastructure/database/connection.js';
import { database } from '@/infrastructure/database/connection.js';
import { deleteInBatchesByCondition } from '@/infrastructure/database/utils/batch-delete.util.js';

// Bound the test so a re-introduced infinite loop FAILS within the timeout instead of hanging the
// whole shard (the pre-fix bug re-selected a full batch of FK-blocked rows forever).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const parentTable = pgTable('batch_delete_loop_parent', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
});

describe('deleteInBatchesByCondition (FK-blocked termination, route-audit A1)', () => {
  beforeAll(async () => {
    await sql`CREATE TABLE IF NOT EXISTS batch_delete_loop_parent (id bigint PRIMARY KEY)`;
    // Non-cascading FK (default NO ACTION) — referenced parents cannot be deleted.
    await sql`CREATE TABLE IF NOT EXISTS batch_delete_loop_child (
      id bigint PRIMARY KEY,
      parent_id bigint NOT NULL REFERENCES batch_delete_loop_parent(id)
    )`;
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS batch_delete_loop_child`;
    await sql`DROP TABLE IF EXISTS batch_delete_loop_parent`;
  });

  beforeEach(async () => {
    await sql`TRUNCATE batch_delete_loop_child, batch_delete_loop_parent`;
  });

  it('terminates and returns correct counts when a full batch is permanently FK-blocked', async () => {
    // Parents 1..5; a child pins the two lowest ids (1, 2) so the FIRST keyset batch (batchSize 2,
    // ascending) is entirely FK-blocked. Pre-fix, that all-blocked batch re-selected forever.
    await sql`INSERT INTO batch_delete_loop_parent (id) VALUES (1),(2),(3),(4),(5)`;
    await sql`INSERT INTO batch_delete_loop_child (id, parent_id) VALUES (101, 1), (102, 2)`;

    const result = await deleteInBatchesByCondition({
      databaseHandle: database as never,
      table: parentTable as never,
      idColumn: parentTable.id as never,
      whereCondition: drizzleSql`true`,
      batchSize: 2,
    });

    expect(result).toEqual({ deletedCount: 3, blockedCount: 2 });
    const remaining = await sql<{ id: number }[]>`
      SELECT id FROM batch_delete_loop_parent ORDER BY id
    `;
    expect(remaining.map((row) => Number(row.id))).toEqual([1, 2]);
  });

  it('deletes every row when nothing is FK-blocked', async () => {
    await sql`INSERT INTO batch_delete_loop_parent (id) VALUES (10),(11),(12),(13),(14)`;

    const result = await deleteInBatchesByCondition({
      databaseHandle: database as never,
      table: parentTable as never,
      idColumn: parentTable.id as never,
      whereCondition: drizzleSql`true`,
      batchSize: 2,
    });

    expect(result).toEqual({ deletedCount: 5, blockedCount: 0 });
    const remaining = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM batch_delete_loop_parent
    `;
    expect(remaining[0]?.count).toBe(0);
  });
});
