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
