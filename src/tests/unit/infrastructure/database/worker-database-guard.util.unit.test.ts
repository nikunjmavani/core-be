import { beforeEach, describe, expect, it, vi } from 'vitest';

const isWorkerRuntimeMock = vi.hoisted(() => vi.fn());
const getWorkerDatabaseContextMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/contexts/worker-database.context.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/infrastructure/database/contexts/worker-database.context.js')
    >();
  return {
    ...actual,
    isWorkerRuntime: isWorkerRuntimeMock,
    getWorkerDatabaseContext: getWorkerDatabaseContextMock,
  };
});

import { assertWorkerRlsGucSet } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import { WorkerDatabaseContextError } from '@/infrastructure/database/contexts/worker-database.context.error.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';

/**
 * Worker RLS guard — the last check before a worker queries a FORCE RLS table.
 *
 * @remarks
 * Row-level security only isolates tenants while the Postgres session variable is actually set.
 * A worker that opens a connection without its GUC would read *every* organization's rows, and
 * the query would look perfectly ordinary. This guard is what makes that failure loud, so its
 * own failure modes are worth pinning:
 *
 * - no worker context at all, or the wrong kind of context;
 * - a GUC that Postgres reports as unset, null, or empty;
 * - a GUC whose value disagrees with the organization or user the job is scoped to — the
 *   cross-tenant case, where a connection is leased from a pool still carrying another tenant's
 *   setting.
 *
 * The suite drives each through the real function with a stubbed database handle, asserting both
 * that it throws and that the message names the GUC — the message is what an operator reads at
 * 3am, so it is part of the contract.
 */
function databaseReturning(currentSetting: string | null): RequestScopedPostgresDatabase {
  return {
    execute: vi.fn(async () => [{ current_setting: currentSetting }]),
  } as unknown as RequestScopedPostgresDatabase;
}

/** The `{ rows: [...] }` shape some drivers return instead of a bare array. */
function databaseReturningRowsEnvelope(currentSetting: string | null) {
  return {
    execute: vi.fn(async () => ({ rows: [{ current_setting: currentSetting }] })),
  } as unknown as RequestScopedPostgresDatabase;
}

describe('assertWorkerRlsGucSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWorkerRuntimeMock.mockReturnValue(true);
  });

  it('is a no-op outside worker runtime', async () => {
    // HTTP requests set the GUC through tenant middleware; this guard is worker-only and must not
    // cost a round trip on the request path.
    isWorkerRuntimeMock.mockReturnValue(false);
    const database = databaseReturning(null);

    await expect(assertWorkerRlsGucSet(database, 'organization')).resolves.toBeUndefined();
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('passes when the context kind matches and the GUC carries a value', async () => {
    getWorkerDatabaseContextMock.mockReturnValue({
      kind: 'organization',
      organizationPublicId: 'org_abcdefghijklmnopqrstu',
    });

    await expect(
      assertWorkerRlsGucSet(databaseReturning('org_abcdefghijklmnopqrstu'), 'organization'),
    ).resolves.toBeUndefined();
  });

  it('accepts the { rows: [...] } driver envelope as well as a bare array', async () => {
    getWorkerDatabaseContextMock.mockReturnValue({ kind: 'global_admin' });

    await expect(
      assertWorkerRlsGucSet(databaseReturningRowsEnvelope('on'), 'global_admin'),
    ).resolves.toBeUndefined();
  });

  it('throws when no worker context has been established', async () => {
    getWorkerDatabaseContextMock.mockReturnValue(undefined);

    await expect(
      assertWorkerRlsGucSet(databaseReturning('anything'), 'organization'),
    ).rejects.toBeInstanceOf(WorkerDatabaseContextError);
  });

  it('throws when the established context is of a different kind', async () => {
    // A job that wrapped itself in a user context must not then query organization-scoped tables.
    getWorkerDatabaseContextMock.mockReturnValue({ kind: 'user', userPublicId: 'usr_x' });

    await expect(
      assertWorkerRlsGucSet(databaseReturning('org_abc'), 'organization'),
    ).rejects.toThrow(/organization/);
  });

  it.each([
    ['null', null],
    ['empty string', ''],
  ])('throws when Postgres reports the GUC as %s', async (_label, value) => {
    getWorkerDatabaseContextMock.mockReturnValue({ kind: 'organization' });

    await expect(assertWorkerRlsGucSet(databaseReturning(value), 'organization')).rejects.toThrow(
      /app\.current_organization_id/,
    );
  });

  it('throws when no row comes back at all', async () => {
    getWorkerDatabaseContextMock.mockReturnValue({ kind: 'organization' });
    const database = { execute: vi.fn(async () => []) } as unknown as RequestScopedPostgresDatabase;

    await expect(assertWorkerRlsGucSet(database, 'organization')).rejects.toBeInstanceOf(
      WorkerDatabaseContextError,
    );
  });

  it('throws when the organization GUC disagrees with the job context (cross-tenant)', async () => {
    // The failure this guard exists for: a pooled connection still carrying the previous job's
    // organization. Without the comparison the query would succeed against the wrong tenant.
    getWorkerDatabaseContextMock.mockReturnValue({
      kind: 'organization',
      organizationPublicId: 'org_aaaaaaaaaaaaaaaaaaaaa',
    });

    const error = await assertWorkerRlsGucSet(
      databaseReturning('org_bbbbbbbbbbbbbbbbbbbbb'),
      'organization',
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(WorkerDatabaseContextError);
    // Both ids belong in the message; an operator needs to know which tenant leaked in.
    expect(String(error)).toContain('org_aaaaaaaaaaaaaaaaaaaaa');
    expect(String(error)).toContain('org_bbbbbbbbbbbbbbbbbbbbb');
  });

  it('throws when the user GUC disagrees with the job context', async () => {
    getWorkerDatabaseContextMock.mockReturnValue({
      kind: 'user',
      userPublicId: 'usr_aaaaaaaaaaaaaaaaaaaaa',
    });

    await expect(
      assertWorkerRlsGucSet(databaseReturning('usr_bbbbbbbbbbbbbbbbbbbbb'), 'user'),
    ).rejects.toThrow(/app\.current_user_id/);
  });

  it('skips the identity comparison when the context carries no id', async () => {
    // Some organization-scoped jobs set only the GUC; the guard should still accept a set value
    // rather than demanding an id the context never had.
    getWorkerDatabaseContextMock.mockReturnValue({ kind: 'organization' });

    await expect(
      assertWorkerRlsGucSet(databaseReturning('org_whatever_is_set'), 'organization'),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['global_retention_cleanup', 'app.global_retention_cleanup'],
    ['global_admin', 'app.global_admin'],
    ['session_retention_cleanup', 'app.session_retention_cleanup'],
  ])('checks the %s context against %s', async (kind, gucKey) => {
    // Each bypass context maps to its own GUC; querying the wrong one would silently pass the
    // guard while the RLS clause it is meant to satisfy stays unset.
    getWorkerDatabaseContextMock.mockReturnValue({ kind });

    await expect(
      assertWorkerRlsGucSet(
        databaseReturning(null),
        kind as 'global_retention_cleanup' | 'global_admin' | 'session_retention_cleanup',
      ),
    ).rejects.toThrow(new RegExp(gucKey.replace('.', '\\.')));
  });
});
