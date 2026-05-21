import { database } from '@/infrastructure/database/connection.js';
import { sql } from '@/infrastructure/database/connection.js';
import { cleanupTestRedis } from '@/tests/helpers/test-redis.js';

const MAX_CLEANUP_RETRIES = 3;
const CLEANUP_RETRY_DELAY_MS = 100;

/**
 * Clean up all test data from the database.
 * Uses a single TRUNCATE ... CASCADE (built in PL/pgSQL) to reduce deadlock risk; retries on deadlock.
 * Only use in test environments.
 */
export async function cleanupDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('cleanupDatabase can only be called in test environment');
  }

  for (let attempt = 1; attempt <= MAX_CLEANUP_RETRIES; attempt++) {
    try {
      await sql`
        DO $$ DECLARE
          tables text;
        BEGIN
          SELECT string_agg(quote_ident(schemaname) || '.' || quote_ident(tablename), ', ')
          INTO tables
          FROM pg_tables
          WHERE schemaname IN ('public', 'auth', 'tenancy', 'billing', 'notify', 'audit', 'upload')
          AND tablename != 'permissions';
          IF tables IS NOT NULL AND tables != '' THEN
            EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
          END IF;
        END $$;
      `;
      await cleanupTestRedis();
      return;
    } catch (error) {
      const isDeadlock =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === '40P01';
      if (isDeadlock && attempt < MAX_CLEANUP_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CLEANUP_RETRY_DELAY_MS * attempt));
        continue;
      }
      throw error;
    }
  }
}

export { database, sql };
