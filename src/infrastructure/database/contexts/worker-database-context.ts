import { AsyncLocalStorage } from 'node:async_hooks';
import { database } from '@/infrastructure/database/connection.js';
import {
  isForceRlsTable,
  type ForceRlsTableRef,
} from '@/infrastructure/database/force-rls-tables.constants.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { runWithPinnedDatabaseHandle } from '@/infrastructure/database/contexts/request-database.context.js';
import { WorkerDatabaseContextError } from '@/infrastructure/database/contexts/worker-database-context.error.js';

export type WorkerDatabaseContextKind =
  | 'organization'
  | 'global_retention_cleanup'
  | 'user'
  | 'session_retention_cleanup'
  | 'system_table';

export interface WorkerDatabaseContext {
  readonly kind: WorkerDatabaseContextKind;
  readonly organizationPublicId?: string;
  readonly userPublicId?: string;
}

export const workerDatabaseContextStorage = new AsyncLocalStorage<WorkerDatabaseContext>();

const FORCE_RLS_ALLOWED_KINDS: ReadonlySet<WorkerDatabaseContextKind> = new Set([
  'organization',
  'global_retention_cleanup',
  'user',
  'session_retention_cleanup',
]);

export function isWorkerRuntime(): boolean {
  return process.env.CORE_BE_RUNTIME === 'worker';
}

export function getWorkerDatabaseContext(): WorkerDatabaseContext | undefined {
  return workerDatabaseContextStorage.getStore();
}

export function runWithWorkerDatabaseContext<T>(
  context: WorkerDatabaseContext,
  callback: () => Promise<T>,
): Promise<T> {
  return workerDatabaseContextStorage.run(context, callback);
}

/**
 * Asserts a worker job has pinned database context before touching Postgres.
 * No-op outside worker runtime.
 */
export function assertWorkerDatabaseContext(
  allowedKinds?: readonly WorkerDatabaseContextKind[],
): void {
  if (!isWorkerRuntime()) {
    return;
  }

  const context = getWorkerDatabaseContext();
  if (context === undefined) {
    throw new WorkerDatabaseContextError(
      'Worker process must not use unpinned database access. Wrap the job in a context helper (withOrganizationContext, runTenantScopedWorkerJob, withGlobalRetentionCleanupDatabaseContext, withUserDatabaseContext, withSessionRetentionCleanupDatabaseContext, or withSystemTableWorkerContext) and pass databaseHandle into createWorker*Repository() factories.',
    );
  }

  if (allowedKinds !== undefined && !allowedKinds.includes(context.kind)) {
    throw new WorkerDatabaseContextError(
      `Worker database context kind "${context.kind}" is not allowed for this operation. Required: ${allowedKinds.join(', ')}.`,
    );
  }
}

/**
 * Asserts worker access to a FORCE RLS table uses an appropriate context kind.
 * No-op outside worker runtime.
 */
export function assertWorkerForceRlsTableAccess(tableRef: ForceRlsTableRef): void {
  if (!isWorkerRuntime()) {
    return;
  }

  if (!isForceRlsTable(tableRef.schemaName, tableRef.tableName)) {
    return;
  }

  const context = getWorkerDatabaseContext();
  if (context === undefined) {
    throw new WorkerDatabaseContextError(
      `Worker queried FORCE RLS table ${tableRef.schemaName}.${tableRef.tableName} without a pinned database context.`,
    );
  }

  if (!FORCE_RLS_ALLOWED_KINDS.has(context.kind)) {
    throw new WorkerDatabaseContextError(
      `Worker context kind "${context.kind}" cannot access FORCE RLS table ${tableRef.schemaName}.${tableRef.tableName}. Use organization, global_retention_cleanup, user, or session_retention_cleanup context.`,
    );
  }
}

/**
 * Explicit bypass for tables without tenant RLS (mail outbox, Stripe webhook ledger).
 * Pins ALS so getRequestDatabase() resolves in worker runtime without opening a transaction.
 */
export async function withSystemTableWorkerContext<T>(
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  if (!isWorkerRuntime()) {
    return callback(database as RequestScopedPostgresDatabase);
  }

  return runWithWorkerDatabaseContext({ kind: 'system_table' }, () =>
    runWithPinnedDatabaseHandle(database as RequestScopedPostgresDatabase, () =>
      callback(database as RequestScopedPostgresDatabase),
    ),
  );
}

export function workerDatabaseContextForOrganization(
  organizationPublicId: string,
): WorkerDatabaseContext {
  return { kind: 'organization', organizationPublicId };
}

export function workerDatabaseContextForUser(userPublicId: string): WorkerDatabaseContext {
  return { kind: 'user', userPublicId };
}
