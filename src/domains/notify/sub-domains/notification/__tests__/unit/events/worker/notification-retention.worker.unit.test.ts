import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runNotificationRetentionJob } from '@/domains/notify/sub-domains/notification/workers/notification-retention.processor.js';

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...arguments_: unknown[]) =>
    deleteInBatchesByConditionMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { NOTIFICATION_RETENTION_DAYS: 365, LOG_LEVEL: 'silent' },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('notification-retention.worker', () => {
  beforeEach(() => {
    deleteInBatchesByConditionMock.mockReset();
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 2, blockedCount: 0 });
  });

  it('runNotificationRetentionJob deletes notifications older than retention window', async () => {
    const result = await runNotificationRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(deleteInBatchesByConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logContext: 'notification-retention',
        tableLabel: 'notify.notifications',
      }),
    );
    expect(result).toEqual({ deletedCount: 2, blockedCount: 0 });
  });
});
