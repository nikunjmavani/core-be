import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { NOTIFICATION_RETENTION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/workers/notification-retention.constants.js';
import { runNotificationRetentionJob } from '@/domains/notify/sub-domains/notification/workers/notification-retention.processor.js';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Hard-deletes in-app notifications older than NOTIFICATION_RETENTION_DAYS.
 * Repeatable schedule is registered in `src/infrastructure/queue/scheduler.ts`.
 */
export function createNotificationRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    NOTIFICATION_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runNotificationRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: NOTIFICATION_RETENTION_QUEUE_NAME },
      'notification-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, NOTIFICATION_RETENTION_QUEUE_NAME);
}
