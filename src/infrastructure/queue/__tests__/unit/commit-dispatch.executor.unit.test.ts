import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitDispatchTask } from '@/infrastructure/queue/commit-dispatch/commit-dispatch.types.js';

const {
  dispatchOutboxEmailMock,
  enqueueNotificationMock,
  notificationRepositoryDeleteMock,
  enqueueUserDataExportMock,
} = vi.hoisted(() => ({
  dispatchOutboxEmailMock: vi.fn().mockResolvedValue(undefined),
  enqueueNotificationMock: vi.fn().mockResolvedValue(undefined),
  notificationRepositoryDeleteMock: vi.fn().mockResolvedValue(undefined),
  enqueueUserDataExportMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/mail/queues/mail.queue.js', () => ({
  dispatchOutboxEmail: (...arguments_: unknown[]) => dispatchOutboxEmailMock(...arguments_),
}));

vi.mock('@/domains/notify/sub-domains/notification/queues/notification.queue.js', () => ({
  enqueueNotification: (...arguments_: unknown[]) => enqueueNotificationMock(...arguments_),
}));

vi.mock('@/domains/notify/sub-domains/notification/notification.repository.js', () => ({
  NotificationRepository: class MockNotificationRepository {
    deleteByInternalId = notificationRepositoryDeleteMock;
  },
}));

vi.mock('@/domains/user/sub-domains/user-data-export/queues/user-data-export.queue.js', () => ({
  enqueueUserDataExport: (...arguments_: unknown[]) => enqueueUserDataExportMock(...arguments_),
}));

describe('executeCommitDispatchTask', () => {
  beforeEach(() => {
    dispatchOutboxEmailMock.mockClear();
    enqueueNotificationMock.mockClear();
    enqueueNotificationMock.mockResolvedValue(undefined);
    notificationRepositoryDeleteMock.mockClear();
    enqueueUserDataExportMock.mockClear();
  });

  it('dispatches mail outbox jobs', async () => {
    const { executeCommitDispatchTask } = await import(
      '@/infrastructure/queue/commit-dispatch/commit-dispatch.executor.js'
    );
    const task: CommitDispatchTask = { type: 'mail_outbox', mailOutboxId: 10, requestId: 'req-1' };
    await executeCommitDispatchTask(task);
    expect(dispatchOutboxEmailMock).toHaveBeenCalledWith(10, { requestId: 'req-1' });
  });

  it('deletes the notification row when enqueue fails', async () => {
    enqueueNotificationMock.mockRejectedValueOnce(new Error('redis unavailable'));
    const { executeCommitDispatchTask } = await import(
      '@/infrastructure/queue/commit-dispatch/commit-dispatch.executor.js'
    );
    await executeCommitDispatchTask({
      type: 'notification',
      notificationId: 42,
      organizationPublicId: 'org_public',
    });
    expect(notificationRepositoryDeleteMock).toHaveBeenCalledWith(42);
  });
});
