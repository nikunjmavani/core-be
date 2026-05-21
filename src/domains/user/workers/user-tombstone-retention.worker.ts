import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runUserTombstoneRetentionJob } from '@/domains/user/workers/user-tombstone-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { USER_TOMBSTONE_RETENTION_QUEUE_NAME } from './user-tombstone-retention.constants.js';

/**
 * Hard-delete users tombstoned longer than TOMBSTONE_RETENTION_DAYS.
 * May skip rows blocked by FK (e.g. organization owner); Postgres errors surface in worker logs.
 */
export function createUserTombstoneRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    USER_TOMBSTONE_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runUserTombstoneRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: USER_TOMBSTONE_RETENTION_QUEUE_NAME },
      'user-tombstone-retention.stalled',
    );
  });

  return buildWorkerHandle(worker, USER_TOMBSTONE_RETENTION_QUEUE_NAME);
}
