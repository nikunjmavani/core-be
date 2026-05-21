import { pingNotificationQueueConnection } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';

/**
 * Verifies BullMQ can reach Redis using the notification queue connection.
 * All queues reuse the same BullMQ Redis options; one representative probe is sufficient.
 */
export async function pingBullMQ(): Promise<void> {
  await pingNotificationQueueConnection();
}
