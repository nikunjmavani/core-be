import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { sampleDeadLetterQueueDepths } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { DLQ_DEPTH_QUEUE_NAME } from '@/infrastructure/observability/dlq-depth/dlq-depth.constants.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * BullMQ worker that samples dead-letter queue depths on a schedule.
 */
export function createDlqDepthWorker(): WorkerHandle {
  const worker = new Worker(
    DLQ_DEPTH_QUEUE_NAME,
    async () => {
      const result = await sampleDeadLetterQueueDepths();
      logger.info({ queueCount: result.depths.length }, 'queue.dlq.depth.sample.completed');
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: 1,
      ...getDefaultWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queueName: DLQ_DEPTH_QUEUE_NAME }, 'queue.dlq.depth.stalled');
  });

  return buildWorkerHandle(worker, DLQ_DEPTH_QUEUE_NAME);
}
