import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { USER_DATA_EXPORT_RETENTION_QUEUE_NAME } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.constants.js';
import { runUserDataExportRetentionJob } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * Purges expired GDPR export rows and their S3 objects (defense-in-depth alongside bucket lifecycle).
 * Repeatable schedule is registered in `src/infrastructure/queue/scheduler.ts`.
 */
export function createUserDataExportRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    USER_DATA_EXPORT_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runUserDataExportRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: USER_DATA_EXPORT_RETENTION_QUEUE_NAME },
      'user-data-export-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, USER_DATA_EXPORT_RETENTION_QUEUE_NAME);
}
