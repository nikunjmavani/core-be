import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import {
  getOrganizationRequestDatabaseSession,
  runWithPinnedOrganizationDatabaseSession,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import {
  runWithWorkerDatabaseContext,
  workerDatabaseContextForOrganization,
} from '@/infrastructure/database/contexts/worker-database.context.js';

/**
 * Runs a callback inside a transaction with RLS organization context set via SET LOCAL.
 * Use for workers/scripts that must enforce tenant isolation at the database layer.
 *
 * When the caller is already inside an HTTP request scoped by
 * `organization-rls-transaction.middleware` for the same `organizationPublicId`, this
 * reuses the active Drizzle handle instead of opening a nested top-level transaction
 * (which would use another pool checkout and lose the outer `SET LOCAL`).
 *
 * The callback receives the pinned `databaseHandle` — pass it into worker repositories
 * via `createWorker*Repository(databaseHandle)` factories.
 */
export async function withOrganizationContext<T>(
  organizationPublicId: string,
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  const activeSession = getOrganizationRequestDatabaseSession();
  if (activeSession !== undefined && activeSession.organizationPublicId === organizationPublicId) {
    return runWithWorkerDatabaseContext(
      workerDatabaseContextForOrganization(organizationPublicId),
      () => callback(activeSession.databaseHandle),
    );
  }

  return runWithWorkerDatabaseContext(
    workerDatabaseContextForOrganization(organizationPublicId),
    () =>
      database.transaction(async (transaction) => {
        const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
        await databaseHandle.execute(
          drizzleSql`SELECT set_config('app.current_organization_id', ${organizationPublicId}, true)`,
        );
        return runWithPinnedOrganizationDatabaseSession(organizationPublicId, databaseHandle, () =>
          callback(databaseHandle),
        );
      }),
  );
}
