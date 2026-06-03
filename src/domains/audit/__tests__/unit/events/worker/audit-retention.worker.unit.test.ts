import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAuditRetentionJob } from '@/domains/audit/workers/audit-retention.processor.js';

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/utils/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...arguments_: unknown[]) =>
    deleteInBatchesByConditionMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { AUDIT_RETENTION_DAYS: 90, LOG_LEVEL: 'silent' },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('audit-retention.worker', () => {
  beforeEach(() => {
    deleteInBatchesByConditionMock.mockReset();
    deleteInBatchesByConditionMock
      .mockResolvedValueOnce({ deletedCount: 4, blockedCount: 0 })
      .mockResolvedValueOnce({ deletedCount: 2, blockedCount: 1 });
  });

  it('runAuditRetentionJob purges both audit logs and the dead-letter ledger past the window', async () => {
    const result = await runAuditRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledTimes(2);
    expect(deleteInBatchesByConditionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        logContext: 'audit-retention',
        tableLabel: 'audit.logs',
      }),
    );
    expect(deleteInBatchesByConditionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        logContext: 'audit-retention.dead-letter',
        tableLabel: 'audit.dead_letter_jobs',
      }),
    );
    expect(result).toEqual({
      deletedCount: 4,
      blockedCount: 0,
      deadLetterDeletedCount: 2,
      deadLetterBlockedCount: 1,
    });
  });
});
