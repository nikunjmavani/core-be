import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUserTombstoneRetentionJob } from '@/domains/user/workers/user-tombstone-retention.processor.js';

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...arguments_: unknown[]) =>
    deleteInBatchesByConditionMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { TOMBSTONE_RETENTION_DAYS: 30, LOG_LEVEL: 'silent' },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('user-tombstone-retention.worker', () => {
  beforeEach(() => {
    deleteInBatchesByConditionMock.mockReset();
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 2, blockedCount: 1 });
  });

  it('runUserTombstoneRetentionJob deletes tombstoned users older than retention window', async () => {
    const result = await runUserTombstoneRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(deleteInBatchesByConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logContext: 'user-tombstone-retention',
        tableLabel: 'auth.users',
      }),
    );
    expect(result).toEqual({ deletedCount: 2, blockedCount: 1 });
  });
});
