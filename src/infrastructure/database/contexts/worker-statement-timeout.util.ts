import { sql as drizzleSql } from 'drizzle-orm';
import { getEnv } from '@/shared/config/env.config.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';

/**
 * sec-D2: lift the connection-level HTTP-tuned `statement_timeout` (5 s) and `lock_timeout` (3 s)
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
  const environment = getEnv();
  await databaseHandle.execute(
    drizzleSql.raw(
      `SET LOCAL statement_timeout = ${Number(environment.DATABASE_WORKER_STATEMENT_TIMEOUT_MS)}`,
    ),
  );
  // Same rationale for lock waits. The connection-level `lock_timeout` is tuned for HTTP (3s, a
  // caller is waiting); a background job with a 5-minute statement budget that abandons a lock
  // after 3s just converts contention into retries and DLQ churn. Lift it for this transaction
  // only — the connection-level cap re-applies on the next checkout.
  await databaseHandle.execute(
    drizzleSql.raw(
      `SET LOCAL lock_timeout = ${Number(environment.DATABASE_WORKER_LOCK_TIMEOUT_MS)}`,
    ),
  );
}
