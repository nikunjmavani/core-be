import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { runMailOutboxSweeperJob } from '@/infrastructure/mail/workers/mail-outbox-sweeper.processor.js';
import { MAIL_OUTBOX_SWEEPER_QUEUE_NAME } from '@/infrastructure/mail/workers/mail-outbox-sweeper.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * Re-enqueues mail_outbox rows stuck in `pending` longer than the configured threshold.
 * Repeatable schedule: `src/infrastructure/queue/scheduler.ts`.
 */
export function createMailOutboxSweeperWorker(): WorkerHandle {
  const worker = new Worker(MAIL_OUTBOX_SWEEPER_QUEUE_NAME, async () => runMailOutboxSweeperJob(), {
    connection: getBullMQConnectionOptions(),
    concurrency: RETENTION_WORKER_CONCURRENCY,
    ...getRetentionWorkerOptions(),
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: MAIL_OUTBOX_SWEEPER_QUEUE_NAME }, 'mail-outbox-sweeper.stalled');
  });

  return buildWorkerHandle(worker, MAIL_OUTBOX_SWEEPER_QUEUE_NAME);
}
