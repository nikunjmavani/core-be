import { UnauthorizedError } from '@/shared/errors/index.js';
import { enqueueNotification } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import type { NotificationRepository } from './notification.repository.js';
import type { UserService } from '@/domains/user/user.service.js';

export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly userService: UserService,
  ) {}

  private async resolveUserId(user_public_id: string): Promise<number> {
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new UnauthorizedError();
    return user.id;
  }

  /**
   * List notifications for a user. Accepts a numeric limit (legacy callers) or an options
   * object so HTTP controllers can pass parsed pagination input forward unchanged.
   */
  async listForUser(user_public_id: string, options: number | { limit?: number } = 50) {
    const limit = typeof options === 'number' ? options : (options.limit ?? 50);
    const userId = await this.resolveUserId(user_public_id);
    return this.repository.findByUser(userId, limit);
  }

  async get(public_id: string, user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return this.repository.findByPublicIdForUser(public_id, userId);
  }

  async markRead(public_id: string, user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return this.repository.markRead(public_id, userId);
  }

  async markAllRead(user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return this.repository.markAllReadForUser(userId);
  }

  async getUnreadCount(user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return this.repository.countUnreadForUser(userId);
  }

  async deleteNotification(public_id: string, user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return this.repository.deleteByPublicIdForUser(public_id, userId);
  }

  /**
   * Enqueue async dispatch for a persisted notification row (email / in-app channels).
   */
  async dispatchNotification(notificationId: number): Promise<void> {
    const organizationPublicId =
      await this.repository.findOrganizationPublicIdByNotificationId(notificationId);
    await enqueueNotification(notificationId, organizationPublicId);
  }
}
