import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUserTombstoneRetentionJob } from '@/domains/user/workers/user-tombstone-retention.processor.js';

/**
 * The domain's only destructive scheduled job: it hard-deletes `auth.users` rows that have been
 * soft-deleted for longer than `TOMBSTONE_RETENTION_DAYS`. Until now it had no processor test at
 * all, so nothing pinned the cutoff arithmetic, the batching, or what happens when Postgres fails
 * mid-sweep — the three ways this job could either delete too much or silently delete nothing.
 */
const { RETENTION_DAYS } = vi.hoisted(() => ({ RETENTION_DAYS: 30 }));
const FIXED_NOW = new Date('2026-08-15T12:00:00.000Z');
/** FIXED_NOW minus RETENTION_DAYS — the boundary rows must be compared against. */
const EXPECTED_CUTOFF = new Date('2026-07-16T12:00:00.000Z');

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/utils/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...arguments_: unknown[]) =>
    deleteInBatchesByConditionMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { TOMBSTONE_RETENTION_DAYS: RETENTION_DAYS, LOG_LEVEL: 'silent' },
}));

const { loggerInfoMock } = vi.hoisted(() => ({ loggerInfoMock: vi.fn() }));
vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const databaseHandle = { kind: 'global-retention' } as never;

describe('user-tombstone-retention.processor', () => {
  beforeEach(() => {
    deleteInBatchesByConditionMock.mockReset();
    loggerInfoMock.mockReset();
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 0, blockedCount: 0 });
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the cutoff from TOMBSTONE_RETENTION_DAYS rather than a bare timestamp', async () => {
    await runUserTombstoneRetentionJob(databaseHandle);

    // The cutoff is only observable through the start log; assert the exact instant so a
    // regression to `new Date()` (purging every tombstone) or to a wrong unit fails here.
    expect(loggerInfoMock).toHaveBeenCalledWith(
      { retentionDays: RETENTION_DAYS, cutoffDate: EXPECTED_CUTOFF.toISOString() },
      'user-tombstone-retention.starting',
    );
  });

  it('deletes through the bounded batch helper against auth.users', async () => {
    await runUserTombstoneRetentionJob(databaseHandle);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(deleteInBatchesByConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseHandle,
        logContext: 'user-tombstone-retention',
        tableLabel: 'auth.users',
        whereCondition: expect.anything(),
      }),
    );
  });

  it('reports the rows it purged when tombstones are older than the cutoff', async () => {
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 12, blockedCount: 0 });

    const result = await runUserTombstoneRetentionJob(databaseHandle);

    expect(result).toEqual({ deletedCount: 12, blockedCount: 0 });
  });

  it('is a no-op when nothing has aged past the cutoff', async () => {
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 0, blockedCount: 0 });

    const result = await runUserTombstoneRetentionJob(databaseHandle);

    expect(result).toEqual({ deletedCount: 0, blockedCount: 0 });
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ deletedCount: 0, blockedCount: 0 }),
      'user-tombstone-retention.completed',
    );
  });

  it('surfaces FK-blocked rows as blockedCount instead of failing the sweep', async () => {
    // A user still referenced by `organizations.owner_user_id` cannot be deleted; the job must
    // count it and keep going so one stuck row never stalls the whole retention window.
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 4, blockedCount: 2 });

    const result = await runUserTombstoneRetentionJob(databaseHandle);

    expect(result).toEqual({ deletedCount: 4, blockedCount: 2 });
    expect(loggerInfoMock).toHaveBeenCalledWith(
      { deletedCount: 4, blockedCount: 2, retentionDays: RETENTION_DAYS },
      'user-tombstone-retention.completed',
    );
  });

  it('propagates a Postgres failure rather than reporting a successful purge', async () => {
    deleteInBatchesByConditionMock.mockRejectedValue(new Error('deadlock detected'));

    await expect(runUserTombstoneRetentionJob(databaseHandle)).rejects.toThrow('deadlock detected');
    expect(loggerInfoMock).not.toHaveBeenCalledWith(
      expect.anything(),
      'user-tombstone-retention.completed',
    );
  });
});
