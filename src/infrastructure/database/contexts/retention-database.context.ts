import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import {
  runWithPinnedDatabaseHandle,
  setLocalDatabaseConfig,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { runWithWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import {
  brandWorkerContextDatabaseHandle,
  type WorkerContextDatabaseHandle,
} from '@/infrastructure/database/utils/database-handle.types.js';
import { applyWorkerStatementTimeout } from '@/infrastructure/database/contexts/worker-statement-timeout.util.js';

/**
 * Runs a callback inside a Postgres transaction with the worker statement-timeout
 * applied, using the `system_table` context kind. Use for retention workers that
 * perform pure-DB bulk operations on non-tenant tables (e.g.
 * `billing.stripe_webhook_events`) where no tenant GUC is required.
 *
 * @remarks
 * - **Algorithm:** Opens a transaction so `SET LOCAL statement_timeout` is
 *   effective (a session-level `SET` would escape the pooled connection on
 *   checkout). Mirrors {@link withGlobalRetentionCleanupDatabaseContext} but
 *   targets non-FORCE-RLS tables and skips the `app.global_retention_cleanup` GUC.
 * - **Failure modes:** Transaction rolls back if the callback throws; the
 *   `statement_timeout` is scoped to this transaction and does not outlive it.
 * - **Side effects:** Opens and closes one Postgres transaction per job; emits
 *   `SET LOCAL statement_timeout` before delegating to the callback.
 * - **Notes:** Do NOT use this wrapper for callers that make external HTTP or
 *   Redis I/O (Resend, BullMQ enqueue, Stripe) — those belong under
 *   {@link withSystemTableWorkerContext}, which does not hold a connection
 *   across external I/O. This variant is only safe for pure-DB callbacks
 *   (sec-new-Q4).
 */
export async function withSystemTableRetentionContext<T>(
  callback: (databaseHandle: WorkerContextDatabaseHandle) => Promise<T>,
): Promise<T> {
  return runWithWorkerDatabaseContext({ kind: 'system_table' }, () =>
    database.transaction(async (transaction) => {
      const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
      await applyWorkerStatementTimeout(databaseHandle);
      return runWithPinnedDatabaseHandle(databaseHandle, () =>
        callback(brandWorkerContextDatabaseHandle(databaseHandle)),
      );
    }),
  );
}

/** Options for {@link withGlobalRetentionCleanupDatabaseContext}. */
export type GlobalRetentionCleanupDatabaseContextOptions = {
  /** When true, `SET LOCAL ROLE core_be_app` for tests that connect as a privileged owner role. */
  useApplicationDatabaseRole?: boolean;
};

/**
 * Runs a callback inside a transaction with `SET LOCAL app.global_retention_cleanup = true`
 * so tombstone and cross-tenant retention workers can access FORCE RLS tables under `core_be_app`.
 */
export async function withGlobalRetentionCleanupDatabaseContext<T>(
  callback: (databaseHandle: WorkerContextDatabaseHandle) => Promise<T>,
  options?: GlobalRetentionCleanupDatabaseContextOptions,
): Promise<T> {
  return runWithWorkerDatabaseContext({ kind: 'global_retention_cleanup' }, () =>
    database.transaction(async (transaction) => {
      const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
      if (options?.useApplicationDatabaseRole === true) {
        await databaseHandle.execute(drizzleSql`SET LOCAL ROLE core_be_app`);
      }
      // sec-D2: lift the connection-level HTTP statement_timeout (5 s) for
      // background work — retention deletes that cascade through audit/
      // session tables would otherwise be killed mid-statement.
      await applyWorkerStatementTimeout(databaseHandle);
      await setLocalDatabaseConfig(databaseHandle, 'app.global_retention_cleanup', 'true');
      return runWithPinnedDatabaseHandle(databaseHandle, () =>
        callback(brandWorkerContextDatabaseHandle(databaseHandle)),
      );
    }),
  );
}
