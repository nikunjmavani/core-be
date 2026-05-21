import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import {
  userDataExportJobDataSchema,
  type UserDataExportJobData,
} from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.job.schema.js';

export const USER_DATA_EXPORT_QUEUE_NAME = 'user-data-export';

let userDataExportQueue: Queue<UserDataExportJobData> | null = null;

function getUserDataExportQueue(): Queue<UserDataExportJobData> {
  if (userDataExportQueue) return userDataExportQueue;
  userDataExportQueue = new Queue<UserDataExportJobData>(USER_DATA_EXPORT_QUEUE_NAME, {
    connection: getBullMQConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  });
  return userDataExportQueue;
}

export async function enqueueUserDataExport(jobData: UserDataExportJobData): Promise<void> {
  const queue = getUserDataExportQueue();
  const validated = parseBullMQJobData(
    userDataExportJobDataSchema,
    jobData,
    USER_DATA_EXPORT_QUEUE_NAME,
  );
  await queue.add('process-user-data-export', validated);
}

export async function closeUserDataExportQueue(): Promise<void> {
  if (userDataExportQueue) {
    await userDataExportQueue.close();
    userDataExportQueue = null;
  }
}
