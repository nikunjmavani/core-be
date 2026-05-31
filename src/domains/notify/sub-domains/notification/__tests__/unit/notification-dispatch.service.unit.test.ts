import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import { createNotificationDispatch } from '@/domains/notify/sub-domains/notification/notification-dispatch.service.js';
import type { NotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';

const enqueueNotificationMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/domains/notify/sub-domains/notification/queues/notification.queue.js', () => ({
  enqueueNotification: (...arguments_: unknown[]) => enqueueNotificationMock(...arguments_),
}));

describe('NotificationDispatch', () => {
  const notificationRepository = {
    create: vi.fn().mockResolvedValue(42),
    findOrganizationPublicIdByOrganizationId: vi.fn().mockResolvedValue('org_public'),
    deleteByInternalId: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationRepository;

  const dispatch = createNotificationDispatch(notificationRepository);

  beforeEach(() => {
    enqueueNotificationMock.mockClear();
    vi.mocked(notificationRepository.create).mockClear();
    vi.mocked(notificationRepository.findOrganizationPublicIdByOrganizationId).mockClear();
  });

  it('defers enqueueNotification until flushOnCommit', async () => {
    enterOnCommitScope();
    await dispatch.createAndDispatchNotification({
      user_id: 1,
      organization_id: 2,
      type: 'billing',
      title: 'Test',
      message: 'Body',
    });

    expect(enqueueNotificationMock).not.toHaveBeenCalled();

    await eventBus.flushOnCommit();
    expect(enqueueNotificationMock).toHaveBeenCalledOnce();
    expect(enqueueNotificationMock).toHaveBeenCalledWith(42, 'org_public');
  });

  it('resolves organization public id before inserting the notification row', async () => {
    const callOrder: string[] = [];
    vi.mocked(
      notificationRepository.findOrganizationPublicIdByOrganizationId,
    ).mockImplementationOnce(async () => {
      callOrder.push('lookup');
      return 'org_public';
    });
    vi.mocked(notificationRepository.create).mockImplementationOnce(async () => {
      callOrder.push('create');
      return 42;
    });

    enterOnCommitScope();
    await dispatch.createAndDispatchNotification({
      user_id: 1,
      organization_id: 2,
      type: 'billing',
      title: 'Test',
      message: 'Body',
    });

    expect(callOrder).toEqual(['lookup', 'create']);
  });

  it('skips organization lookup and passes null public id for user-only notifications', async () => {
    enterOnCommitScope();
    await dispatch.createAndDispatchNotification({
      user_id: 1,
      type: 'system',
      title: 'Test',
      message: 'Body',
    });

    expect(notificationRepository.findOrganizationPublicIdByOrganizationId).not.toHaveBeenCalled();

    await eventBus.flushOnCommit();
    expect(enqueueNotificationMock).toHaveBeenCalledWith(42, null);
  });

  it('does not create the notification when organization lookup fails', async () => {
    const lookupError = new Error('organization lookup failed');
    vi.mocked(
      notificationRepository.findOrganizationPublicIdByOrganizationId,
    ).mockRejectedValueOnce(lookupError);

    await expect(
      dispatch.createAndDispatchNotification({
        user_id: 1,
        organization_id: 2,
        type: 'billing',
        title: 'Test',
        message: 'Body',
      }),
    ).rejects.toBe(lookupError);

    expect(notificationRepository.create).not.toHaveBeenCalled();
  });

  it('deletes the notification row when post-commit enqueue fails', async () => {
    const enqueueError = new Error('redis unavailable');
    enqueueNotificationMock.mockRejectedValueOnce(enqueueError);

    enterOnCommitScope();
    await dispatch.createAndDispatchNotification({
      user_id: 1,
      organization_id: 2,
      type: 'billing',
      title: 'Test',
      message: 'Body',
    });

    await eventBus.flushOnCommit();

    expect(notificationRepository.deleteByInternalId).toHaveBeenCalledWith(42);
  });
});
