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
