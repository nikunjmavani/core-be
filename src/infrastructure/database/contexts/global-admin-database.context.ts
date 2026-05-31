import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import {
  runWithPinnedDatabaseHandle,
  setLocalDatabaseConfig,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { runWithWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database.context.js';

/** Options for {@link withGlobalAdminDatabaseContext}. */
export type GlobalAdminDatabaseContextOptions = {
  /** When true, `SET LOCAL ROLE core_be_app` so tests exercise the non-superuser admin path. */
  useApplicationDatabaseRole?: boolean;
};

/**
 * Runs a callback inside a transaction with `SET LOCAL app.global_admin = true` so cross-user admin
 * and system flows can read/write FORCE RLS tables under the non-superuser `core_be_app` role —
 * including `auth.users`, `auth.auth_methods`, and cross-tenant `audit.logs` reads (admin audit
 * listing, user suspend/soft-delete, cross-user actor lookups).
 *
 * @remarks
 * - **Algorithm:** mirrors {@link withGlobalRetentionCleanupDatabaseContext} — opens (or reuses, via
 *   `runWithPinnedDatabaseHandle`) a transaction, sets the `app.global_admin` GUC with `SET LOCAL`
 *   (auto-reset at transaction end), and pins the handle in ALS so `getRequestDatabase()` resolves
 *   to it for the duration of the callback.
 * - **Failure modes:** propagates any error from the callback; the surrounding transaction rolls
 *   back, discarding the GUC.
 * - **Side effects:** opens a database transaction and toggles the admin RLS escape hatch for its
 *   lifetime.
 * - **SECURITY:** `app.global_admin = 'true'` bypasses per-user / per-tenant isolation on protected
 *   tables (including `auth.users`, `auth.auth_methods`, and cross-tenant `audit.logs`). This
 *   wrapper MUST only be entered from code paths that have already
 *   authorized the caller as a global admin (HTTP routes guarded by `requireRole(SUPER_ADMIN,
 *   ADMIN)`) or from trusted system/offboarding code. Never call it on an unauthenticated or
 *   self-service request path.
 */
export async function withGlobalAdminDatabaseContext<T>(
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
  options?: GlobalAdminDatabaseContextOptions,
): Promise<T> {
  return runWithWorkerDatabaseContext({ kind: 'global_admin' }, () =>
    database.transaction(async (transaction) => {
      const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
      if (options?.useApplicationDatabaseRole === true) {
        await databaseHandle.execute(drizzleSql`SET LOCAL ROLE core_be_app`);
      }
      await setLocalDatabaseConfig(databaseHandle, 'app.global_admin', 'true');
      return runWithPinnedDatabaseHandle(databaseHandle, () => callback(databaseHandle));
    }),
  );
}
