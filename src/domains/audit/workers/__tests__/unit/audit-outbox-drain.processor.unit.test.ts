import { beforeEach, describe, expect, it, vi } from 'vitest';

const drainRepositoryMock = vi.hoisted(() => ({
  claimPendingBatch: vi.fn(),
  markProcessed: vi.fn().mockResolvedValue(undefined),
  recordTransientFailure: vi.fn().mockResolvedValue(undefined),
  markPermanentlyFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/audit/audit-outbox.repository.js', () => ({
  createDrainAuditOutboxRepository: vi.fn(() => drainRepositoryMock),
}));

const setLocalDatabaseConfigMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  setLocalDatabaseConfig: (...args: unknown[]) => setLocalDatabaseConfigMock(...args),
}));

interface FakeDatabaseHandle {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
}

function buildDatabaseHandle(
  userIdByPublicId: Record<string, number>,
  orgIdByPublicId: Record<string, number>,
  apiKeyIdByPublicId: Record<string, number>,
  insertOverride?: () => Promise<void>,
): FakeDatabaseHandle {
  const userRows = Object.entries(userIdByPublicId).map(([public_id, id]) => ({ id, public_id }));
  const orgRows = Object.entries(orgIdByPublicId).map(([public_id, id]) => ({ id, public_id }));
  const apiKeyRows = Object.entries(apiKeyIdByPublicId).map(([public_id, id]) => ({
    id,
    public_id,
  }));

  let callIndex = 0;
  const responses = [userRows, orgRows, apiKeyRows];

  const select = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      where: vi.fn().mockImplementation(async (_predicate: unknown) => {
        const rows = responses[callIndex] ?? [];
        callIndex += 1;
        return rows;
      }),
    })),
  }));

  const insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation(async (_row: unknown) => {
      if (insertOverride) return insertOverride();
      return undefined;
    }),
  }));

  return { select, insert };
}

interface OutboxRowOverride {
  id?: number;
  actor_user_public_id?: string | null;
  actor_api_key_public_id?: string | null;
  target_user_public_id?: string | null;
  organization_public_id?: string | null;
  attempt_count?: number;
}

function buildOutboxRow(overrides: OutboxRowOverride = {}): Record<string, unknown> {
  // `??` collapses `null` to the default, which is the wrong semantics here — `null`
  // is a meaningful explicit value for the optional public_id columns (tenantless rows,
  // user-only audits without an organization, etc.). Use a `hasOwnProperty`-style check
  // so the caller can distinguish "use default" (omit the key) from "this field is null".
  const pickNullable = <K extends keyof OutboxRowOverride>(
    key: K,
    fallback: NonNullable<OutboxRowOverride[K]> | null,
  ): OutboxRowOverride[K] | null => (key in overrides ? (overrides[key] ?? null) : fallback);

  return {
    id: overrides.id ?? 1,
    status: 'PENDING',
    actor_user_public_id: pickNullable('actor_user_public_id', 'user_a'),
    actor_api_key_public_id: pickNullable('actor_api_key_public_id', null),
    target_user_public_id: pickNullable('target_user_public_id', null),
    organization_public_id: pickNullable('organization_public_id', 'org_a'),
    action: 'user.login',
    resource_type: 'user',
    resource_id: null,
    ip_address: '203.0.113.1',
    user_agent: 'test/1.0',
    severity: 'INFO',
    metadata: {},
    attempt_count: overrides.attempt_count ?? 1,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    processed_at: null,
  };
}

describe('runAuditOutboxDrainJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts and writes nothing when no PENDING rows exist', async () => {
    drainRepositoryMock.claimPendingBatch.mockResolvedValueOnce([]);
    const databaseHandle = buildDatabaseHandle({}, {}, {});
    const { runAuditOutboxDrainJob } = await import(
      '@/domains/audit/workers/audit-outbox-drain.processor.js'
    );

    const result = await runAuditOutboxDrainJob(databaseHandle as never);

    expect(result).toEqual({ drained: 0, transientFailed: 0, permanentlyFailed: 0 });
    expect(setLocalDatabaseConfigMock).not.toHaveBeenCalled();
    expect(databaseHandle.insert).not.toHaveBeenCalled();
  });

  it('drains a tenant row: resolves public ids, sets per-row org GUC, inserts audit.logs, marks PROCESSED', async () => {
    const row = buildOutboxRow({
      id: 100,
      actor_user_public_id: 'user_a',
      organization_public_id: 'org_a',
    });
    drainRepositoryMock.claimPendingBatch.mockResolvedValueOnce([row]);
    const databaseHandle = buildDatabaseHandle({ user_a: 5 }, { org_a: 10 }, {});
    const { runAuditOutboxDrainJob } = await import(
      '@/domains/audit/workers/audit-outbox-drain.processor.js'
    );

    const result = await runAuditOutboxDrainJob(databaseHandle as never);

    expect(result).toEqual({ drained: 1, transientFailed: 0, permanentlyFailed: 0 });
    // First setLocalDatabaseConfig is the global-admin lift for resolution.
    expect(setLocalDatabaseConfigMock).toHaveBeenNthCalledWith(
      1,
      databaseHandle,
      'app.global_admin',
      'true',
    );
    // Per-row org GUC for the audit.logs INSERT RLS.
    expect(setLocalDatabaseConfigMock).toHaveBeenNthCalledWith(
      2,
      databaseHandle,
      'app.current_organization_id',
      'org_a',
    );
    expect(databaseHandle.insert).toHaveBeenCalledTimes(1);
    expect(drainRepositoryMock.markProcessed).toHaveBeenCalledExactlyOnceWith([100]);
  });

  it('drains a tenantless row using the system_audit_insert arm', async () => {
    const row = buildOutboxRow({
      id: 101,
      actor_user_public_id: 'user_a',
      organization_public_id: null,
    });
    drainRepositoryMock.claimPendingBatch.mockResolvedValueOnce([row]);
    const databaseHandle = buildDatabaseHandle({ user_a: 5 }, {}, {});
    const { runAuditOutboxDrainJob } = await import(
      '@/domains/audit/workers/audit-outbox-drain.processor.js'
    );

    const result = await runAuditOutboxDrainJob(databaseHandle as never);

    expect(result.drained).toBe(1);
    expect(setLocalDatabaseConfigMock).toHaveBeenCalledWith(
      databaseHandle,
      'app.system_audit_insert',
      'true',
    );
  });

  it('marks a row permanently FAILED when the actor public_id no longer resolves', async () => {
    const row = buildOutboxRow({
      id: 102,
      actor_user_public_id: 'user_deleted',
      organization_public_id: 'org_a',
    });
    drainRepositoryMock.claimPendingBatch.mockResolvedValueOnce([row]);
    const databaseHandle = buildDatabaseHandle({}, { org_a: 10 }, {});
    const { runAuditOutboxDrainJob } = await import(
      '@/domains/audit/workers/audit-outbox-drain.processor.js'
    );

    const result = await runAuditOutboxDrainJob(databaseHandle as never);

    expect(result).toEqual({ drained: 0, transientFailed: 0, permanentlyFailed: 1 });
    expect(drainRepositoryMock.markPermanentlyFailed).toHaveBeenCalledExactlyOnceWith(
      102,
      expect.stringMatching(/actor public_id did not resolve/),
    );
    expect(databaseHandle.insert).not.toHaveBeenCalled();
  });

  it('records a TRANSIENT failure on first DB error and KEEPS the row PENDING for retry', async () => {
    const row = buildOutboxRow({
      id: 103,
      actor_user_public_id: 'user_a',
      organization_public_id: 'org_a',
      attempt_count: 1,
    });
    drainRepositoryMock.claimPendingBatch.mockResolvedValueOnce([row]);
    const databaseHandle = buildDatabaseHandle({ user_a: 5 }, { org_a: 10 }, {}, async () => {
      throw new Error('rls-rejected');
    });
    const { runAuditOutboxDrainJob } = await import(
      '@/domains/audit/workers/audit-outbox-drain.processor.js'
    );

    const result = await runAuditOutboxDrainJob(databaseHandle as never);

    expect(result).toEqual({ drained: 0, transientFailed: 1, permanentlyFailed: 0 });
    expect(drainRepositoryMock.recordTransientFailure).toHaveBeenCalledExactlyOnceWith(
      103,
      'rls-rejected',
    );
    expect(drainRepositoryMock.markPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('escalates to permanently FAILED when attempt_count would exceed the cap', async () => {
    // attempt_count 4 → on this drain pass it becomes 5 (the default max), so any
    // failure must mark the row terminally instead of transient.
    const row = buildOutboxRow({
      id: 104,
      actor_user_public_id: 'user_a',
      organization_public_id: 'org_a',
      attempt_count: 4,
    });
    drainRepositoryMock.claimPendingBatch.mockResolvedValueOnce([row]);
    const databaseHandle = buildDatabaseHandle({ user_a: 5 }, { org_a: 10 }, {}, async () => {
      throw new Error('rls-rejected');
    });
    const { runAuditOutboxDrainJob } = await import(
      '@/domains/audit/workers/audit-outbox-drain.processor.js'
    );

    const result = await runAuditOutboxDrainJob(databaseHandle as never);

    expect(result).toEqual({ drained: 0, transientFailed: 0, permanentlyFailed: 1 });
    expect(drainRepositoryMock.markPermanentlyFailed).toHaveBeenCalledExactlyOnceWith(
      104,
      'rls-rejected',
    );
    expect(drainRepositoryMock.recordTransientFailure).not.toHaveBeenCalled();
  });
});
