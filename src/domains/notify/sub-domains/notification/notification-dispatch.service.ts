import { eventBus } from '@/core/events/event-bus.js';
import { enqueueNotification } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import type {
  NotificationRepository,
  CreateNotificationInput,
} from '@/domains/notify/sub-domains/notification/notification.repository.js';
import { ConfigurationError } from '@/shared/errors/index.js';

export type NotificationDispatch = {
  createAndDispatchNotification(input: CreateNotificationInput): Promise<void>;
};

export function createNotificationDispatch(
  notificationRepository: NotificationRepository,
): NotificationDispatch {
  return {
    async createAndDispatchNotification(input: CreateNotificationInput): Promise<void> {
      // Resolve organization public id BEFORE the insert so failure of either step
      // leaves no orphan notification row: a lookup failure short-circuits before
      // any write, and an insert failure means there is nothing to enqueue.
      const organization_public_id =
        input.organization_id === undefined
          ? null
          : await notificationRepository.findOrganizationPublicIdByOrganizationId(
              input.organization_id,
            );
      const notification_id = await notificationRepository.create(input);
      eventBus.onCommit(() => enqueueNotification(notification_id, organization_public_id));
    },
  };
}

let notificationDispatch: NotificationDispatch | null = null;

export function configureNotificationDispatch(dispatch: NotificationDispatch): void {
  notificationDispatch = dispatch;
}

/**
 * Persist a notification row and enqueue async channel dispatch (in-app / email).
 * Used by notify domain event handlers reacting to cross-domain events.
 */
export async function createAndDispatchNotification(input: CreateNotificationInput): Promise<void> {
  if (!notificationDispatch) {
    throw new ConfigurationError(
      'Notification dispatch is not configured. Call configureNotificationDispatch from notify.container.',
    );
  }
  await notificationDispatch.createAndDispatchNotification(input);
}
