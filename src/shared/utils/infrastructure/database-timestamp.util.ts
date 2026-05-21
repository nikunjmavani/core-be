import { sql, type SQL } from 'drizzle-orm';

/**
 * Postgres `now()` for Drizzle `.set()` on timestamptz columns.
 * Use instead of `new Date()` so `updated_at >= created_at` check constraints hold
 * when a row is updated immediately after insert (DB clock vs JS clock skew).
 */
export const databaseNowTimestamp: SQL = sql`now()`;
