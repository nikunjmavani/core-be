import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { withTransaction } from '@/infrastructure/database/transaction.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { users } from '@/domains/user/user.schema.js';

describe('withTransaction', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('commits when callback resolves', async () => {
    const user = await createTestUser({ email: 'txn-commit@example.com' });
    await withTransaction(async (transaction) => {
      await (transaction as typeof database)
        .update(users)
        .set({ first_name: 'Committed' })
        .where(eq(users.id, user.id));
    });

    const [row] = await database.select().from(users).where(eq(users.id, user.id));
    expect(row?.first_name).toBe('Committed');
  });

  it('rolls back when callback throws', async () => {
    const user = await createTestUser({ email: 'txn-rollback@example.com' });
    await expect(
      withTransaction(async (transaction) => {
        await (transaction as typeof database)
          .update(users)
          .set({ first_name: 'ShouldRollback' })
          .where(eq(users.id, user.id));
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const [row] = await database.select().from(users).where(eq(users.id, user.id));
    expect(row?.first_name).not.toBe('ShouldRollback');
  });

  it('propagates the original error message', async () => {
    await expect(
      withTransaction(async () => {
        throw new Error('original-txn-error');
      }),
    ).rejects.toThrow('original-txn-error');
  });

  it('sets local statement_timeout inside the transaction', async () => {
    let timeoutSetting: string | null = null;
    await withTransaction(
      async (transaction) => {
        const result = await (transaction as typeof database).execute(
          sql`SELECT current_setting('statement_timeout', true) AS timeout`,
        );
        const rows = result as unknown as { timeout: string }[];
        timeoutSetting = rows[0]?.timeout ?? null;
      },
      { timeoutMs: 5_000 },
    );
    expect(timeoutSetting === '5000ms' || timeoutSetting === '5s').toBe(true);
  });
});
