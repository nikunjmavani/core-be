import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** Drizzle handle for a single Postgres checkout (pool, transaction, or pinned ALS session). */
export type PostgresDatabaseHandle = PostgresJsDatabase;

declare const workerContextDatabaseHandleBrand: unique symbol;

/**
 * Nominal type for Drizzle handles obtained from a worker database context wrapper.
 * Only {@link brandWorkerContextDatabaseHandle} can produce this type so repositories
 * cannot accidentally accept the process-wide pool singleton at compile time.
 */
export type WorkerContextDatabaseHandle = PostgresDatabaseHandle & {
  readonly [workerContextDatabaseHandleBrand]: true;
};

/**
 * Brands a checkout handle that was opened inside a worker context wrapper.
 *
 * @remarks
 * - **Algorithm:** zero-cost cast — runtime safety remains in {@link assertWorkerDatabaseContext}.
 * - **Failure modes:** none at runtime; misuse is a compile-time error at call sites.
 * - **Side effects:** none.
 * - **Notes:** call only from context wrappers immediately before invoking worker callbacks.
 */
export function brandWorkerContextDatabaseHandle(
  handle: PostgresDatabaseHandle,
): WorkerContextDatabaseHandle {
  return handle as WorkerContextDatabaseHandle;
}
