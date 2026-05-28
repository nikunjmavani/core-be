import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import {
  notificationJobDataSchema,
  type NotificationJobDataValidated,
} from './notification.job.schema.js';

/** BullMQ queue name for asynchronous notification dispatch (in-app + email fan-out). */
export const NOTIFICATION_QUEUE_NAME = 'notification';

/** Only ids are stored in Redis; content is loaded in the worker from Postgres with org scoping. */
export type NotificationJobData = NotificationJobDataValidated;

let notificationQueue: Queue<NotificationJobData> | null = null;

function getNotificationQueue(): Queue<NotificationJobData> {
  if (notificationQueue) return notificationQueue;
  notificationQueue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
    connection: getBullMQConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  });
  return notificationQueue;
}

/**
 * Enqueue a notification for async delivery across configured channels.
 */
export async function enqueueNotification(
  notificationId: number,
  organizationPublicId: string | null,
  requestId?: string,
): Promise<void> {
  const queue = getNotificationQueue();
  const jobData = parseBullMQJobData(
    notificationJobDataSchema,
    { notificationId, organizationPublicId, requestId },
    NOTIFICATION_QUEUE_NAME,
  );
  await queue.add('dispatch-notification', jobData);
}

/** Close the lazily-initialised notification queue (graceful-shutdown hook for tests/runtime). */
export async function closeNotificationQueue(): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.close();
    notificationQueue = null;
  }
}

/**
 * Verifies BullMQ can reach Redis through the Queue API used by producers.
 */
export async function pingNotificationQueueConnection(): Promise<void> {
  const queue = getNotificationQueue();
  await queue.waitUntilReady();
  await queue.getJobCounts('waiting');
}
