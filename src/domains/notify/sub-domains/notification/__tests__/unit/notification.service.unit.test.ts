import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { NotificationService } from '@/domains/notify/sub-domains/notification/notification.service.js';
import type { NotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';
import type { UserService } from '@/domains/user/user.service.js';

vi.mock('@/domains/notify/sub-domains/notification/queues/notification.queue.js', () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

const user = { id: 1, public_id: 'user_public' };
const notification = {
  id: 2,
  public_id: 'notif_public',
  user_id: 1,
  title: 'Hello',
  body: 'World',
  read_at: null,
  created_at: new Date(),
};

describe('NotificationService', () => {
  const userService = {
    findUserRecordByPublicId: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const repository = {
    findByUser: vi.fn().mockResolvedValue([notification]),
    findByPublicIdForUser: vi.fn().mockResolvedValue(notification),
    markRead: vi.fn().mockResolvedValue({ ...notification, read_at: new Date() }),
    markAllReadForUser: vi.fn().mockResolvedValue(2),
    countUnreadForUser: vi.fn().mockResolvedValue(3),
    deleteByPublicIdForUser: vi.fn().mockResolvedValue(notification),
    findOrganizationPublicIdByNotificationId: vi.fn().mockResolvedValue('org_public'),
  } as unknown as NotificationRepository;

  const service = new NotificationService(repository, userService);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(user as never);
  });

  it('listForUser returns notifications', async () => {
    const result = await service.listForUser('user_public', 50);
    expect(result).toHaveLength(1);
  });

  it('get returns notification for user', async () => {
    const result = await service.get('notif_public', 'user_public');
    expect(result?.public_id).toBe('notif_public');
  });

  it('resolveUserId throws when user missing', async () => {
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
    await expect(service.listForUser('missing', 50)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('markRead updates notification', async () => {
    await service.markRead('notif_public', 'user_public');
    expect(repository.markRead).toHaveBeenCalled();
  });

  it('getUnreadCount returns count', async () => {
    const result = await service.getUnreadCount('user_public');
    expect(result).toBe(3);
  });

  it('dispatchNotification enqueues delivery job', async () => {
    const { enqueueNotification } =
      await import('@/domains/notify/sub-domains/notification/queues/notification.queue.js');
    await service.dispatchNotification(2);
    expect(enqueueNotification).toHaveBeenCalledWith(2, 'org_public');
  });

  it('markAllRead and deleteNotification delegate to repository', async () => {
    await service.markAllRead('user_public');
    await service.deleteNotification('notif_public', 'user_public');
    expect(repository.markAllReadForUser).toHaveBeenCalled();
    expect(repository.deleteByPublicIdForUser).toHaveBeenCalled();
  });
});
