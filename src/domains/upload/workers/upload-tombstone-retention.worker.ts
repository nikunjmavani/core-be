import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runUploadTombstoneRetentionJob } from '@/domains/upload/workers/upload-tombstone-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME } from './upload-tombstone-retention.constants.js';

/**
 * Hard-delete uploads tombstoned longer than TOMBSTONE_RETENTION_DAYS.
 * Removes S3 objects before deleting rows.
 */
export function createUploadTombstoneRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runUploadTombstoneRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME },
      'upload-tombstone-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, UPLOAD_TOMBSTONE_RETENTION_QUEUE_NAME);
}
