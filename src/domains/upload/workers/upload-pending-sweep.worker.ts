import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runUploadPendingSweepJob } from '@/domains/upload/workers/upload-pending-sweep.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { UPLOAD_PENDING_SWEEP_QUEUE_NAME } from './upload-pending-sweep.constants.js';

/**
 * Reconciles orphan PENDING uploads (presigned URL issued, confirm never called).
 * Repeatable schedule: src/infrastructure/queue/scheduler.ts.
 */
export function createUploadPendingSweepWorker(): WorkerHandle {
  const worker = new Worker(
    UPLOAD_PENDING_SWEEP_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runUploadPendingSweepJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: UPLOAD_PENDING_SWEEP_QUEUE_NAME }, 'upload-pending-sweep.stalled');
  });

  return buildWorkerHandle(worker, UPLOAD_PENDING_SWEEP_QUEUE_NAME);
}
