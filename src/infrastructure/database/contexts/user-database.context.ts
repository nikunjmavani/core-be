import { database } from '@/infrastructure/database/connection.js';
import {
  getOrganizationRequestDatabaseSession,
  runWithPinnedDatabaseHandle,
  setLocalDatabaseConfig,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import {
  runWithWorkerDatabaseContext,
  workerDatabaseContextForUser,
} from '@/infrastructure/database/contexts/worker-database.context.js';

/**
 * Sets `app.current_user_id` (auth.users public_id) for user-scoped RLS policies.
 * Reuses the active organization RLS transaction when present.
 */
export async function withUserDatabaseContext<T>(
  userPublicId: string,
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  return runWithWorkerDatabaseContext(workerDatabaseContextForUser(userPublicId), async () => {
    const organizationSession = getOrganizationRequestDatabaseSession();
    if (organizationSession?.organizationPublicId) {
      await setLocalDatabaseConfig(
        organizationSession.databaseHandle,
        'app.current_user_id',
        userPublicId,
      );
      return callback(organizationSession.databaseHandle);
    }

    return database.transaction(async (transaction) => {
      const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
      await setLocalDatabaseConfig(databaseHandle, 'app.current_user_id', userPublicId);
      return runWithPinnedDatabaseHandle(databaseHandle, () => callback(databaseHandle));
    });
  });
}

/**
 * Sets `app.current_session_public_id` for cookie-based refresh (no JWT yet).
 */
export async function withSessionPublicIdDatabaseContext<T>(
  sessionPublicId: string,
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
    await setLocalDatabaseConfig(databaseHandle, 'app.current_session_public_id', sessionPublicId);
    return runWithPinnedDatabaseHandle(databaseHandle, () => callback(databaseHandle));
  });
}

/**
 * Sets `app.current_session_token_hash` for bearer-token logout revocation.
 */
export async function withSessionTokenHashDatabaseContext<T>(
  tokenHash: string,
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
    await setLocalDatabaseConfig(databaseHandle, 'app.current_session_token_hash', tokenHash);
    return runWithPinnedDatabaseHandle(databaseHandle, () => callback(databaseHandle));
  });
}

/**
 * Allows cross-user session retention deletes from the cleanup worker.
 */
export async function withSessionRetentionCleanupDatabaseContext<T>(
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  return runWithWorkerDatabaseContext({ kind: 'session_retention_cleanup' }, () =>
    database.transaction(async (transaction) => {
      const databaseHandle = transaction as unknown as RequestScopedPostgresDatabase;
      await setLocalDatabaseConfig(databaseHandle, 'app.session_retention_cleanup', 'true');
      return runWithPinnedDatabaseHandle(databaseHandle, () => callback(databaseHandle));
    }),
  );
}
