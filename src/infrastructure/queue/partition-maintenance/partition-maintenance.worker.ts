import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { PARTITION_MAINTENANCE_QUEUE_NAME } from '@/infrastructure/queue/partition-maintenance/partition-maintenance.constants.js';
import { runPartitionMaintenanceJob } from '@/infrastructure/queue/partition-maintenance/partition-maintenance.processor.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Constructs the BullMQ worker that consumes the `partition-maintenance` queue.
 *
 * @remarks
 * - **Algorithm:** binds a single processor that calls {@link runPartitionMaintenanceJob};
 *   uses `RETENTION_WORKER_CONCURRENCY` (= 1) so DDL never overlaps with itself.
 * - **Failure modes:** processor failures retry under the shared retention worker options;
 *   final failures flow through DLQ + Sentry via `attachDeadLetterAndAlerting`.
 * - **Side effects:** opens a BullMQ Redis connection; emits a `partition-maintenance.stalled`
 *   warning on the BullMQ `stalled` event.
 * - **Notes:** registered as `family: 'retention'`, `scheduled: false` in the worker
 *   registry — no cron is wired in `scheduler.ts` yet, so jobs are enqueued ad-hoc by
 *   operators or follow-up tooling.
 */
export function createPartitionMaintenanceWorker(): WorkerHandle {
  const worker = new Worker(
    PARTITION_MAINTENANCE_QUEUE_NAME,
    async () => runPartitionMaintenanceJob(),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: PARTITION_MAINTENANCE_QUEUE_NAME },
      'partition-maintenance.stalled',
    );
  });

  return buildWorkerHandle(worker, PARTITION_MAINTENANCE_QUEUE_NAME);
}
