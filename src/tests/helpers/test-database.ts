import { database } from '@/infrastructure/database/connection.js';
import { sql } from '@/infrastructure/database/connection.js';
import { cleanupTestRedis } from '@/tests/helpers/test-redis.js';

const MAX_CLEANUP_RETRIES = 3;
const CLEANUP_RETRY_DELAY_MS = 100;

/**
 * Environments where wiping all rows is acceptable: the ephemeral `test` database and a
 * developer's `local` Docker Compose database. The chaos suite runs with `NODE_ENV=local`
 * because `.env.local` is layered as an override (see `load-env-files`), so `local` must be
 * permitted here. `development`/`staging`/`production` are never allowed to be truncated.
 */
const DATA_WIPE_ALLOWED_ENVIRONMENTS = new Set(['test', 'local']);

/**
 * Clean up all test data from the database.
 * Uses a single TRUNCATE ... CASCADE (built in PL/pgSQL) to reduce deadlock risk; retries on deadlock.
 * Only use in the `test` or `local` environment (see {@link DATA_WIPE_ALLOWED_ENVIRONMENTS}).
 */
export async function cleanupDatabase(): Promise<void> {
  if (!DATA_WIPE_ALLOWED_ENVIRONMENTS.has(process.env.NODE_ENV ?? '')) {
    throw new Error('cleanupDatabase can only be called in the test or local environment');
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
