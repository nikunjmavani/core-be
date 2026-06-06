import { sql as drizzleSql } from 'drizzle-orm';
import { getEnv } from '@/shared/config/env.config.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';

/**
 * sec-D2: lift the connection-level HTTP statement_timeout (5 s by default)
 * for the duration of a worker transaction.
 *
 * `buildPostgresOptions` applies `statement_timeout` at connection time
 * tuned for HTTP traffic. Background work (retention deletes, GDPR scans,
 * DLQ sweeps) operates on much larger row counts and was being killed
 * mid-statement once the underlying table grew. Apply `SET LOCAL` at the
 * start of every worker context wrapper so the bump only affects that
 * transaction; the connection-level cap immediately re-applies for the
 * next checkout.
 *
 * Read from {@link getEnv} so the cap is operator-tunable without code
 * changes; default 5 minutes — large enough for cascading FK deletes
 * across audit/session tables, small enough to bound a runaway query
 * holding a pool checkout.
 */
export async function applyWorkerStatementTimeout(
  databaseHandle: RequestScopedPostgresDatabase,
): Promise<void> {
  const timeoutMs = getEnv().DATABASE_WORKER_STATEMENT_TIMEOUT_MS;
  await databaseHandle.execute(
    drizzleSql.raw(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`),
  );
}
