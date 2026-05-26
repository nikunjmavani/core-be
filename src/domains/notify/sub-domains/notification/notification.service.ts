import { UnauthorizedError } from '@/shared/errors/index.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { enqueueNotification } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { PAGINATION } from '@/shared/constants/pagination.constants.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { NotificationRepository } from './notification.repository.js';
import type { UserService } from '@/domains/user/user.service.js';

export interface NotificationListServiceOptions {
  after?: string;
  limit?: number;
  include_total?: boolean;
}

/**
 * Persists in-app notifications and enqueues delivery for the owning user.
 */
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
   * List notifications for a user using keyset pagination. Accepts a numeric limit (legacy
   * callers) or an options object so HTTP controllers can pass parsed pagination input
   * forward unchanged.
   */
  async listForUser(
    user_public_id: string,
    options: number | NotificationListServiceOptions = PAGINATION.DEFAULT_LIMIT,
  ) {
    const resolved = typeof options === 'number' ? { limit: options } : options;
    const limit = resolved.limit ?? PAGINATION.DEFAULT_LIMIT;
    const userId = await this.resolveUserId(user_public_id);
    return withUserDatabaseContext(user_public_id, () =>
      this.repository.findByUser(
        userId,
        omitUndefined({
          after: resolved.after,
          limit,
          include_total: resolved.include_total,
        }),
      ),
    );
  }

  async get(public_id: string, user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return withUserDatabaseContext(user_public_id, () =>
      this.repository.findByPublicIdForUser(public_id, userId),
    );
  }

  async markRead(public_id: string, user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return withUserDatabaseContext(user_public_id, () =>
      this.repository.markRead(public_id, userId),
    );
  }

  async markAllRead(user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return withUserDatabaseContext(user_public_id, () =>
      this.repository.markAllReadForUser(userId),
    );
  }

  async getUnreadCount(user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return withUserDatabaseContext(user_public_id, () =>
      this.repository.countUnreadForUser(userId),
    );
  }

  async deleteNotification(public_id: string, user_public_id: string) {
    const userId = await this.resolveUserId(user_public_id);
    return withUserDatabaseContext(user_public_id, () =>
      this.repository.deleteByPublicIdForUser(public_id, userId),
    );
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
