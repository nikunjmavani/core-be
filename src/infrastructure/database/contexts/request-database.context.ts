import { AsyncLocalStorage } from 'node:async_hooks';
import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import type { PostgresDatabaseHandle } from '@/infrastructure/database/database-handle.types.js';
import { isWorkerRuntime } from '@/infrastructure/database/contexts/worker-database.context.js';
import { WorkerDatabaseContextError } from '@/infrastructure/database/contexts/worker-database.context.error.js';

export type RequestScopedPostgresDatabase = PostgresDatabaseHandle;

/**
 * Fastify HTTP requests that send `X-Organization-Id` run inside a single Drizzle
 * transaction with `SET LOCAL app.current_organization_id` so every query shares one
 * checkout from the postgres.js pool and RLS policies see a stable GUC.
 *
 * Workers must use context wrappers that pin ALS via `runWithPinnedOrganizationDatabaseSession`
 * and pass the explicit `databaseHandle` into processors/repositories — never rely on the
 * global pool fallback from `getRequestDatabase()` outside a pinned session.
 */
export interface OrganizationRequestDatabaseSession {
  readonly databaseHandle: RequestScopedPostgresDatabase;
  readonly organizationPublicId: string;
}

export const organizationRequestDatabaseStorage =
  new AsyncLocalStorage<OrganizationRequestDatabaseSession>();

export function getRequestDatabase(): RequestScopedPostgresDatabase {
  const session = organizationRequestDatabaseStorage.getStore();
  if (session !== undefined) {
    return session.databaseHandle;
  }

  if (isWorkerRuntime()) {
    throw new WorkerDatabaseContextError(
      'Worker process must not use unpinned database access. Wrap the job in a context helper and pass databaseHandle into createWorker*Repository() factories.',
    );
  }

  return database;
}

export function getOrganizationRequestDatabaseSession():
  | OrganizationRequestDatabaseSession
  | undefined {
  return organizationRequestDatabaseStorage.getStore();
}

/**
 * Pins `databaseHandle` in ALS so `getRequestDatabase()` returns the same checkout for
 * tenant-scoped worker and HTTP organization RLS transactions.
 */
export function runWithPinnedOrganizationDatabaseSession<T>(
  organizationPublicId: string,
  databaseHandle: RequestScopedPostgresDatabase,
  callback: () => Promise<T>,
): Promise<T> {
  return organizationRequestDatabaseStorage.run({ databaseHandle, organizationPublicId }, callback);
}

/**
 * Pins `databaseHandle` in ALS for retention/session workers without a tenant public id.
 */
export function runWithPinnedDatabaseHandle<T>(
  databaseHandle: RequestScopedPostgresDatabase,
  callback: () => Promise<T>,
): Promise<T> {
  const existingSession = getOrganizationRequestDatabaseSession();
  return organizationRequestDatabaseStorage.run(
    {
      databaseHandle,
      organizationPublicId: existingSession?.organizationPublicId ?? '',
    },
    callback,
  );
}

export async function setLocalDatabaseConfig(
  databaseHandle: RequestScopedPostgresDatabase,
  key: string,
  value: string,
): Promise<void> {
  await databaseHandle.execute(drizzleSql`SELECT set_config(${key}, ${value}, true)`);
}
