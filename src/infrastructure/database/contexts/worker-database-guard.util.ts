import { sql as drizzleSql } from 'drizzle-orm';
import {
  getRequestDatabase,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import type { WorkerDatabaseContextKind } from '@/infrastructure/database/contexts/worker-database.context.js';
import {
  assertWorkerDatabaseContext,
  getWorkerDatabaseContext,
  isWorkerRuntime,
} from '@/infrastructure/database/contexts/worker-database.context.js';
import { WorkerDatabaseContextError } from '@/infrastructure/database/contexts/worker-database.context.error.js';

const GUC_BY_CONTEXT_KIND: Record<
  Exclude<WorkerDatabaseContextKind, 'system_table'>,
  { key: string; label: string }
> = {
  organization: { key: 'app.current_organization_id', label: 'organization' },
  global_retention_cleanup: {
    key: 'app.global_retention_cleanup',
    label: 'global retention cleanup',
  },
  user: { key: 'app.current_user_id', label: 'user' },
  session_retention_cleanup: {
    key: 'app.session_retention_cleanup',
    label: 'session retention cleanup',
  },
};

/**
 * Resolves the Drizzle handle for repositories. In worker runtime, requires an explicit
 * handle or a pinned ALS session from a context wrapper.
 */
export function resolveRepositoryDatabaseHandle(
  databaseHandle: RequestScopedPostgresDatabase | undefined,
): RequestScopedPostgresDatabase {
  if (databaseHandle !== undefined) {
    return databaseHandle;
  }

  if (isWorkerRuntime()) {
    assertWorkerDatabaseContext();
  }

  return getRequestDatabase();
}

/**
 * Verifies the Postgres session GUC for the active worker context kind is set (non-empty).
 * Call from createWorker*Repository factories before tenant-scoped queries.
 */
export async function assertWorkerRlsGucSet(
  databaseHandle: RequestScopedPostgresDatabase,
  expectedKind: Exclude<WorkerDatabaseContextKind, 'system_table'>,
): Promise<void> {
  if (!isWorkerRuntime()) {
    return;
  }

  const context = getWorkerDatabaseContext();
  if (context === undefined || context.kind !== expectedKind) {
    throw new WorkerDatabaseContextError(
      `Expected worker database context kind "${expectedKind}" before querying FORCE RLS tables.`,
    );
  }

  // eslint-disable-next-line security/detect-object-injection -- expectedKind is a typed WorkerDatabaseContextKind.
  const guc = GUC_BY_CONTEXT_KIND[expectedKind];
  const rows = await databaseHandle.execute<{ current_setting: string | null }>(
    drizzleSql`SELECT current_setting(${guc.key}, true) AS current_setting`,
  );
  const resultRows = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: { current_setting: string | null }[] }).rows ?? []);
  const value = resultRows[0]?.current_setting;
  if (value === null || value === undefined || value === '') {
    throw new WorkerDatabaseContextError(
      `Postgres session variable ${guc.key} is not set for ${guc.label} worker context.`,
    );
  }

  if (
    expectedKind === 'organization' &&
    context.organizationPublicId !== undefined &&
    value !== context.organizationPublicId
  ) {
    throw new WorkerDatabaseContextError(
      `Postgres ${guc.key} (${value}) does not match worker context organization (${context.organizationPublicId}).`,
    );
  }

  if (
    expectedKind === 'user' &&
    context.userPublicId !== undefined &&
    value !== context.userPublicId
  ) {
    throw new WorkerDatabaseContextError(
      `Postgres ${guc.key} (${value}) does not match worker context user (${context.userPublicId}).`,
    );
  }
}
