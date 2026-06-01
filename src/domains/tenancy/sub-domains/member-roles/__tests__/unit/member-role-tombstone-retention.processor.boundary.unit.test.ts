import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMemberRoleTombstoneRetentionJob } from '@/domains/tenancy/sub-domains/member-roles/workers/member-role-tombstone-retention.processor.js';

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/utils/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...arguments_: unknown[]) =>
    deleteInBatchesByConditionMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { TOMBSTONE_RETENTION_DAYS: 30, LOG_LEVEL: 'silent' },
}));

const { loggerInfoMock } = vi.hoisted(() => ({ loggerInfoMock: vi.fn() }));
vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn() },
}));

describe('member-role-tombstone-retention.processor boundary cases', () => {
  beforeEach(() => {
    deleteInBatchesByConditionMock.mockReset();
    loggerInfoMock.mockReset();
  });

  it('purges only tombstones older than the cutoff', async () => {
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 1, blockedCount: 0 });

    const result = await runMemberRoleTombstoneRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(deleteInBatchesByConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logContext: 'member-role-tombstone-retention',
        tableLabel: 'tenancy.roles',
      }),
    );
    expect(result).toEqual({ deletedCount: 1, blockedCount: 0 });
  });

  it('keeps rows at or younger than the cutoff (no rows matched)', async () => {
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 0, blockedCount: 0 });

    const result = await runMemberRoleTombstoneRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ deletedCount: 0, blockedCount: 0 });
  });

  it('logs purge counts on completion', async () => {
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 3, blockedCount: 2 });

    await runMemberRoleTombstoneRetentionJob({} as never);

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ deletedCount: 3, blockedCount: 2, retentionDays: 30 }),
      'member-role-tombstone-retention.completed',
    );
  });
});
