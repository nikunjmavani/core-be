import { describe, it, expect } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

const runTestcontainers = process.env.USE_TESTCONTAINERS === '1';

/**
 * Optional hermetic Postgres via Testcontainers (not used in default CI — Compose services instead).
 * Run with: USE_TESTCONTAINERS=1 pnpm vitest run src/tests/integration/testcontainers-postgres.test.ts
 */
describe.runIf(runTestcontainers)('Integration: Testcontainers Postgres', () => {
  it('should connect and run a simple query', async () => {
    const container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const connectionString = container.getConnectionUri();
    const sql = postgres(connectionString, { max: 1 });

    try {
      const rows = await sql<{ value: number }[]>`SELECT 1 AS value`;
      expect(rows[0]?.value).toBe(1);
    } finally {
      await sql.end({ timeout: 5_000 });
      await container.stop();
    }
  }, 120_000);
});
