import { Queue } from 'bullmq';
import { getBullMQProducerConnectionOptions } from '@/infrastructure/queue/connection.js';
import { DEFAULT_JOB_RETENTION_COUNT } from '@/infrastructure/queue/queue.constants.js';
import { captureTraceContextForPropagation } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { FIVE_SECONDS_MS, SEVEN_DAYS_SECONDS } from '@/shared/constants/ttl.constants.js';
import {
  userDataExportJobDataSchema,
  type UserDataExportJobData,
} from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.job.schema.js';

/** BullMQ queue name for asynchronous GDPR export bundling. */
export const USER_DATA_EXPORT_QUEUE_NAME = 'user-data-export';

let userDataExportQueue: Queue<UserDataExportJobData> | null = null;

function getUserDataExportQueue(): Queue<UserDataExportJobData> {
  if (userDataExportQueue) return userDataExportQueue;
  userDataExportQueue = new Queue<UserDataExportJobData>(USER_DATA_EXPORT_QUEUE_NAME, {
    connection: getBullMQProducerConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: DEFAULT_JOB_RETENTION_COUNT, age: SEVEN_DAYS_SECONDS },
      removeOnFail: { count: DEFAULT_JOB_RETENTION_COUNT, age: SEVEN_DAYS_SECONDS },
      attempts: 3,
      backoff: { type: 'exponential', delay: FIVE_SECONDS_MS },
    },
  });
  return userDataExportQueue;
}

/**
 * Enqueue a `process-user-data-export` job. Payload is re-validated against
 * {@link userDataExportJobDataSchema} so a malformed payload fails before it lands in Redis.
 * Default options: 3 attempts with exponential backoff (5s base) and bounded retention.
 */
export async function enqueueUserDataExport(jobData: UserDataExportJobData): Promise<void> {
  const queue = getUserDataExportQueue();
  const validated = parseBullMQJobData(
    userDataExportJobDataSchema,
    { ...jobData, ...captureTraceContextForPropagation() },
    USER_DATA_EXPORT_QUEUE_NAME,
  );
  await queue.add('process-user-data-export', validated);
}

/** Disconnect the queue's BullMQ client during graceful shutdown / test teardown. */
export async function closeUserDataExportQueue(): Promise<void> {
  if (userDataExportQueue) {
    await userDataExportQueue.close();
    userDataExportQueue = null;
  }
}
