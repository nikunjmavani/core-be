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
      .mockResolvedValueOnce({ deletedCount: 2, blockedCount: 1 })
      // sec-D5: third call is auth.verification_tokens cleanup.
      .mockResolvedValueOnce({ deletedCount: 11, blockedCount: 0 });
  });

  it('runAuditRetentionJob purges audit logs, dead-letter ledger, and expired verification tokens past the window', async () => {
    const result = await runAuditRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledTimes(3);
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
    expect(deleteInBatchesByConditionMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        logContext: 'audit-retention.verification-tokens',
        tableLabel: 'auth.verification_tokens',
      }),
    );
    expect(result).toEqual({
      deletedCount: 4,
      blockedCount: 0,
      deadLetterDeletedCount: 2,
      deadLetterBlockedCount: 1,
      verificationTokenDeletedCount: 11,
      verificationTokenBlockedCount: 0,
    });
  });
});
