import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { runDlqAutoRetryJob } from '@/infrastructure/queue/dlq/dlq-auto-retry.processor.js';
import { DLQ_AUTO_RETRY_QUEUE_NAME } from '@/infrastructure/queue/dlq/dlq-auto-retry.constants.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * BullMQ worker that automatically replays replayable dead-letter ledger rows when circuits recover.
 *
 * @remarks
 * - **Algorithm:** delegates to {@link runDlqAutoRetryJob} on each scheduled tick.
 * - **Failure modes:** processor errors propagate to BullMQ retry/DLQ handling.
 * - **Side effects:** see {@link runDlqAutoRetryJob}.
 * - **Notes:** registered from worker bootstrap; cron in `scheduler.ts`.
 */
export function createDlqAutoRetryWorker(): WorkerHandle {
  const worker = new Worker(DLQ_AUTO_RETRY_QUEUE_NAME, async () => runDlqAutoRetryJob(), {
    connection: getBullMQConnectionOptions(),
    concurrency: RETENTION_WORKER_CONCURRENCY,
    ...getRetentionWorkerOptions(),
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: DLQ_AUTO_RETRY_QUEUE_NAME }, 'dlq-auto-retry.stalled');
  });

  return buildWorkerHandle(worker, DLQ_AUTO_RETRY_QUEUE_NAME);
}
