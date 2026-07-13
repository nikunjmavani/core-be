import { database } from '@/infrastructure/database/connection.js';
import { sql } from '@/infrastructure/database/connection.js';
import { env } from '@/shared/config/env.config.js';
import { cleanupTestRedis } from '@/tests/helpers/test-redis.js';

const MAX_CLEANUP_RETRIES = 3;
const CLEANUP_RETRY_DELAY_MS = 100;

/**
 * Whether wiping all rows is acceptable. Requires BOTH the master `TEST_MODE` gate (this is a test
 * run) AND the specific `TEST_DATA_WIPE_ALLOWED` flag. Both default false and a schema refine forbids
 * either being `true` in production, so a deployed data store can never be truncated. The test harness
 * sets both true; a developer sets both in `.env.local` to wipe a local development database.
 */
function isDataWipeAllowed(): boolean {
  return env.TEST_MODE && env.TEST_DATA_WIPE_ALLOWED;
}

/**
 * Clean up all test data from the database.
 * Uses a single TRUNCATE ... CASCADE (built in PL/pgSQL) to reduce deadlock risk; retries on deadlock.
 * Only use in `test` or a non-hosted `development` environment (see {@link isDataWipeAllowed}).
 */
export async function cleanupDatabase(): Promise<void> {
  if (!isDataWipeAllowed()) {
    throw new Error(
      'cleanupDatabase is disabled: it requires TEST_MODE=true AND TEST_DATA_WIPE_ALLOWED=true. ' +
        'The Vitest harness sets both; for a manual run set them in .env.local (NODE_ENV=local/development). ' +
        'Both are refine-forbidden in production, so this can never truncate a deployed database.',
    );
  }

  for (let attempt = 1; attempt <= MAX_CLEANUP_RETRIES; attempt++) {
    try {
      await sql`
        DO $$ DECLARE
          tables text;
        BEGIN
          -- Cleanup can occasionally exceed per-statement limits in CI matrix shards.
          -- Scope timeout override to this transaction only.
          PERFORM set_config('statement_timeout', '0', true);
          -- public.schema_migrations is the migration audit trail and MUST NOT be truncated.
          -- Wiping it forces the vitest global-setup pnpm db:migrate to re-apply
          -- every migration from the top on the next test run, which trips DDL
          -- non-idempotency in older migrations (e.g. CREATE POLICY without
          -- IF NOT EXISTS) and silently leaves the DB in a pre-fix state.
          -- public.permissions is exempted for the same reason (system reference data).
          SELECT string_agg(quote_ident(schemaname) || '.' || quote_ident(tablename), ', ')
          INTO tables
          FROM pg_tables
          WHERE schemaname IN ('public', 'auth', 'tenancy', 'billing', 'notify', 'audit', 'upload')
          AND tablename != 'permissions'
          AND NOT (schemaname = 'public' AND tablename = 'schema_migrations');
          IF tables IS NOT NULL AND tables != '' THEN
            EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
          END IF;
        END $$;
      `;
      await cleanupTestRedis();
      return;
    } catch (error) {
      const isDeadlockOrTimeout =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['40P01', '57014'].includes((error as { code: string }).code);
      if (isDeadlockOrTimeout && attempt < MAX_CLEANUP_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CLEANUP_RETRY_DELAY_MS * attempt));
        continue;
      }
      throw error;
    }
  }
}

export { database, sql };
