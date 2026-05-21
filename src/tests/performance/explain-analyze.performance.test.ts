import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { AuditRepository } from '@/domains/audit/audit.repository.js';

const runExplainTests = process.env.RUN_EXPLAIN_TESTS !== '0';

describe.runIf(runExplainTests)('Performance: EXPLAIN ANALYZE', () => {
  const auditRepository = new AuditRepository();

  beforeAll(async () => {
    await sql`GRANT core_be_app TO core`.catch(() => undefined);
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_users_email_trgm
      ON auth.users
      USING GIN (email gin_trgm_ops)
    `;
    const indexRows = await sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'auth'
        AND tablename = 'users'
        AND indexname = 'idx_users_email_trgm'
    `;
    if (indexRows.length === 0) {
      throw new Error(
        'idx_users_email_trgm is missing; run pnpm db:migrate (migrations/20260522000001_users_email_name_trgm.sql)',
      );
    }
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('should use an index scan for audit logs filtered by organization_id', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    for (let index = 0; index < 5; index++) {
      await auditRepository.insert({
        organization_id: organization.id,
        actor_user_id: user.id,
        action: 'test.action',
        resource_type: 'organization',
        metadata: { index },
      });
    }

    const planRows = await sql<{ 'QUERY PLAN': string }[]>`
      EXPLAIN (FORMAT TEXT)
      SELECT id FROM audit.logs
      WHERE organization_id = ${organization.id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    const planText = planRows.map((row) => row['QUERY PLAN']).join('\n');
    expect(planText.toLowerCase()).not.toContain('seq scan on logs');
    expect(planText.toLowerCase()).toMatch(/index|bitmap/);
  });

  it('should use pg_trgm GIN index for admin user email ILIKE search', async () => {
    const searchTerm = 'admin-search';
    for (let index = 0; index < 40; index++) {
      await createTestUser({ email: `${searchTerm}-${index}@example.com` });
    }
    await sql`ANALYZE auth.users`;

    const pattern = `%${searchTerm}%`;
    const planRows = await sql.begin(async (transaction) => {
      await transaction`SET LOCAL enable_seqscan = off`;
      return transaction<{ 'QUERY PLAN': string }[]>`
        EXPLAIN (FORMAT TEXT)
        SELECT id FROM auth.users
        WHERE email ILIKE ${pattern}
        LIMIT 20
      `;
    });

    const planText = planRows
      .map((row) => row['QUERY PLAN'])
      .join('\n')
      .toLowerCase();
    expect(planText).not.toContain('seq scan on users');
    expect(planText).toMatch(/idx_users_email_trgm|gin.*idx_users_email_trgm/);
  });
});
