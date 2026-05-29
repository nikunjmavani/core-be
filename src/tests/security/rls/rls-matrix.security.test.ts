import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { sql as drizzleSql } from 'drizzle-orm';
import {
  EXPECTED_FORCE_RLS_TABLES,
  RLS_MATRIX_SKIP_CRUD_TABLES,
  USER_SCOPED_FORCE_RLS_TABLES,
  countRowsAsTenant,
  countRowsAsUser,
  deleteRowAsTenant,
  executeAsCoreBeAppTenant,
  executeAsCoreBeAppUser,
  grantCoreBeAppRoleForTests,
  listForceRlsTablesFromDatabase,
  seedRlsMatrixFixtures,
  seedUserScopedRlsFixtures,
  tableKey,
  updateRowAsTenant,
} from '@/tests/helpers/rls-matrix.helper.js';
import { diffForceRlsTables } from '@/infrastructure/database/force-rls-tables.constants.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

describe('Security: RLS matrix (all FORCE RLS tables)', () => {
  beforeAll(async () => {
    await grantCoreBeAppRoleForTests();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('live FORCE-RLS set must match EXPECTED_FORCE_RLS_TABLES exactly (no drift)', async () => {
    // Audit #16: assert DB truth == intentional registry. No table is skipped when missing — a
    // table that should be FORCE RLS but is not (or one that is forced but undeclared) fails here
    // instead of silently no-op'ing the worker guard and the matrix below.
    const databaseTables = await listForceRlsTablesFromDatabase();
    const { missing, extra } = diffForceRlsTables(databaseTables);

    expect(
      missing,
      `Tables expected FORCE RLS but not enforced in the database: ${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      extra,
      `Tables FORCE RLS in the database but absent from EXPECTED_FORCE_RLS_TABLES: ${extra.join(', ')}`,
    ).toEqual([]);
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

  describe.each(USER_SCOPED_FORCE_RLS_TABLES)('user-scoped isolation ($schemaName.$tableName)', ({
    schemaName,
    tableName,
  }) => {
    it('returns zero rows when the user context is unset', async () => {
      await seedUserScopedRlsFixtures();
      const count = await countRowsAsUser(schemaName, tableName, null);
      expect(count, `${tableKey(schemaName, tableName)} with unset user context`).toBe(0);
    });

    it('shows only the current user rows and none of another user (cross-user denial)', async () => {
      const fixture = await seedUserScopedRlsFixtures();

      const visibleForA = await countRowsAsUser(schemaName, tableName, fixture.userAPublicId);
      expect(visibleForA, `${tableKey(schemaName, tableName)} own rows`).toBe(1);

      // User A must not see user B's row even by primary key.
      const rowIds = fixture.rowIdsByTable.get(tableKey(schemaName, tableName))!;
      await executeAsCoreBeAppUser(fixture.userAPublicId, async (transaction) => {
        const qualified = `"${schemaName}"."${tableName}"`;
        const idColumn = tableName === 'user_settings' ? 'user_id' : 'id';
        const result = await transaction.execute(
          drizzleSql.raw(
            `SELECT count(*)::int AS count FROM ${qualified} WHERE ${idColumn} = ${rowIds.userB}`,
          ),
        );
        const rows = Array.isArray(result)
          ? result
          : ((result as { rows?: { count: number }[] }).rows ?? []);
        expect(Number(rows[0]?.count ?? 0), `${tableKey(schemaName, tableName)} cross-user`).toBe(
          0,
        );
      });
    });
  });

  describe('API-key authentication under FORCE RLS (audit #3)', () => {
    it('plain SELECT on tenancy.api_keys returns 0 rows with no org context (demonstrates the bug)', async () => {
      const fixture = await seedRlsMatrixFixtures();
      void fixture;
      // No app.current_organization_id → tenant-isolation policy resolves to NULL → 0 rows. This is
      // why the auth phase (which has no org context yet) cannot look a key up directly.
      const count = await countRowsAsTenant('tenancy', 'api_keys', null);
      expect(count).toBe(0);
    });

    it('resolver returns the candidate key + owning org with no org context (non-superuser)', async () => {
      const fixture = await seedRlsMatrixFixtures();

      // core_be_app (non-superuser) with NO org context — exactly the auth-phase connection state.
      const resolved = await executeAsCoreBeAppTenant(null, async (transaction) => {
        const result = await transaction.execute(
          drizzleSql`SELECT * FROM tenancy.resolve_api_key_for_authentication('prefix-a')`,
        );
        return Array.isArray(result)
          ? result
          : ((result as { rows?: Record<string, unknown>[] }).rows ?? []);
      });

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.organization_public_id).toBe(fixture.organizationAPublicId);
      expect(resolved[0]?.key_hash).toBe('hash-a');
      expect(resolved[0]?.status).toBe('ACTIVE');
    });
  });
});
