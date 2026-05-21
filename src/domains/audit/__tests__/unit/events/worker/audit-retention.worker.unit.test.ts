import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAuditRetentionJob } from '@/domains/audit/workers/audit-retention.processor.js';

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/batch-delete.util.js', () => ({
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
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 4, blockedCount: 0 });
  });

  it('runAuditRetentionJob deletes audit logs older than retention window', async () => {
    const result = await runAuditRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(deleteInBatchesByConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logContext: 'audit-retention',
        tableLabel: 'audit.logs',
      }),
    );
    expect(result).toEqual({ deletedCount: 4, blockedCount: 0 });
  });
});
