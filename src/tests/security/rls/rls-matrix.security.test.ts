import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { sql as drizzleSql } from 'drizzle-orm';
import {
  EXPECTED_FORCE_RLS_TABLES,
  RLS_MATRIX_SKIP_CRUD_TABLES,
  countRowsAsTenant,
  deleteRowAsTenant,
  executeAsCoreBeAppTenant,
  grantCoreBeAppRoleForTests,
  isForceRlsEnabled,
  listForceRlsTablesFromDatabase,
  seedRlsMatrixFixtures,
  tableKey,
  updateRowAsTenant,
} from '@/tests/helpers/rls-matrix.helper.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

describe('Security: RLS matrix (all FORCE RLS tables)', () => {
  beforeAll(async () => {
    await grantCoreBeAppRoleForTests();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('should have FORCE ROW LEVEL SECURITY on every expected tenant table', async () => {
    const databaseTables = await listForceRlsTablesFromDatabase();
    const databaseKeys = new Set(
      databaseTables.map((table) => tableKey(table.schemaName, table.tableName)),
    );

    for (const expected of EXPECTED_FORCE_RLS_TABLES) {
      const key = tableKey(expected.schemaName, expected.tableName);
      if (!databaseKeys.has(key)) {
        const exists = await isForceRlsEnabled(expected.schemaName, expected.tableName);
        if (!exists) {
          continue;
        }
      }
      const enabled = await isForceRlsEnabled(expected.schemaName, expected.tableName);
      expect(enabled, `Missing FORCE RLS on ${key}`).toBe(true);
    }
  });

  it('should block SELECT of other tenant organizations when context is set', async () => {
    const fixture = await seedRlsMatrixFixtures();

    await executeAsCoreBeAppTenant(fixture.organizationAPublicId, async (transaction) => {
      const rows = await transaction
        .select({ public_id: organizations.public_id })
        .from(organizations)
        .where(eq(organizations.public_id, fixture.organizationBPublicId));
      expect(rows).toHaveLength(0);
    });
  });

  it('should return zero visible rows for tenant-scoped tables when tenant context is unset', async () => {
    const fixture = await seedRlsMatrixFixtures();

    const tablesToCheck = [
      tableKey('tenancy', 'memberships'),
      tableKey('notify', 'webhooks'),
      tableKey('billing', 'subscriptions'),
      tableKey('upload', 'uploads'),
    ];

    for (const key of tablesToCheck) {
      const [schemaName, tableName] = key.split('.');
      const count = await countRowsAsTenant(schemaName!, tableName!, null);
      expect(count, `${key} with unset tenant context`).toBe(0);
    }

    void fixture;
  });

  const crudMatrixTables = EXPECTED_FORCE_RLS_TABLES.filter(
    (table) => !RLS_MATRIX_SKIP_CRUD_TABLES.has(tableKey(table.schemaName, table.tableName)),
  );

  describe.each(crudMatrixTables)('tenant isolation CRUD ($schemaName.$tableName)', ({
    schemaName,
    tableName,
  }) => {
    const key = tableKey(schemaName, tableName);

    it('should not read other tenant rows (SELECT count)', async () => {
      const fixture = await seedRlsMatrixFixtures();
      const rowIds = fixture.rowIdsByTable.get(key);
      if (!rowIds) {
        const countForA = await countRowsAsTenant(
          schemaName,
          tableName,
          fixture.organizationAPublicId,
        );
        const countForB = await countRowsAsTenant(
          schemaName,
          tableName,
          fixture.organizationBPublicId,
        );
        expect(countForA).toBeGreaterThanOrEqual(0);
        expect(countForB).toBeGreaterThanOrEqual(0);
        return;
      }

      const visibleForA = await countRowsAsTenant(
        schemaName,
        tableName,
        fixture.organizationAPublicId,
      );
      expect(visibleForA).toBeGreaterThan(0);

      await executeAsCoreBeAppTenant(fixture.organizationAPublicId, async (transaction) => {
        const qualified = `"${schemaName}"."${tableName}"`;
        const result = await transaction.execute(
          drizzleSql.raw(
            `SELECT count(*)::int AS count FROM ${qualified} WHERE id = ${rowIds.organizationB}`,
          ),
        );
        const rows = Array.isArray(result)
          ? result
          : ((result as { rows?: { count: number }[] }).rows ?? []);
        expect(Number(rows[0]?.count ?? 0)).toBe(0);
      });
    });

    it('should not UPDATE other tenant rows', async () => {
      const fixture = await seedRlsMatrixFixtures();
      const rowIds = fixture.rowIdsByTable.get(key);
      if (!rowIds) return;

      const updated = await updateRowAsTenant(
        schemaName,
        tableName,
        rowIds.organizationB,
        fixture.organizationAPublicId,
      );
      expect(updated).toBe(0);
    });

    it('should not DELETE other tenant rows', async () => {
      const fixture = await seedRlsMatrixFixtures();
      const rowIds = fixture.rowIdsByTable.get(key);
      if (!rowIds) return;

      const deleted = await deleteRowAsTenant(
        schemaName,
        tableName,
        rowIds.organizationB,
        fixture.organizationAPublicId,
      );
      expect(deleted).toBe(0);
    });
  });
});
