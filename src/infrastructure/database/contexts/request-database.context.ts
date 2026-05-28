import { AsyncLocalStorage } from 'node:async_hooks';
import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import type { PostgresDatabaseHandle } from '@/infrastructure/database/database-handle.types.js';
import { isWorkerRuntime } from '@/infrastructure/database/contexts/worker-database.context.js';
import { WorkerDatabaseContextError } from '@/infrastructure/database/contexts/worker-database.context.error.js';

/**
 * Drizzle handle pinned to a single postgres.js checkout for the lifetime of an
 * HTTP request transaction or worker-scoped context — alias of
 * {@link PostgresDatabaseHandle} carried through ALS by the helpers in this file.
 */
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

/**
 * AsyncLocalStorage carrying the active {@link OrganizationRequestDatabaseSession} for
 * the current request/worker job — exported so middleware and context wrappers can
 * `.run()` and `.getStore()` against the same storage instance.
 */
export const organizationRequestDatabaseStorage =
  new AsyncLocalStorage<OrganizationRequestDatabaseSession>();

/**
 * Returns the pinned transaction handle from ALS when present, falling back to the
 * pool-level {@link database} for HTTP requests outside a tenant transaction. Throws
 * in worker runtime if no context has been pinned to prevent silent RLS bypass.
 */
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

/**
 * Returns the full pinned session (database handle + tenant public id) without
 * triggering the worker-runtime guard — use when callers need the organization
 * identifier alongside the handle, e.g. for event emission or logging.
 */
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

/**
 * Sets a transaction-scoped Postgres GUC (`SET LOCAL` via `set_config(..., true)`)
 * on the supplied handle. Used to pin RLS-driving variables such as
 * `app.current_organization_id` and `app.global_retention_cleanup` for the
 * duration of the surrounding transaction.
 */
export async function setLocalDatabaseConfig(
  databaseHandle: RequestScopedPostgresDatabase,
  key: string,
  value: string,
): Promise<void> {
  await databaseHandle.execute(drizzleSql`SELECT set_config(${key}, ${value}, true)`);
}
