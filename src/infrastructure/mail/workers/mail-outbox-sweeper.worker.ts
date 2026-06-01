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
 * BullMQ worker wrapping {@link runMailOutboxSweeperJob} on the mail-outbox
 * sweeper queue.
 *
 * @remarks
 * - **Algorithm:** single-job-per-tick worker driven by the repeatable scheduler
 *   in `src/infrastructure/queue/scheduler.ts`; concurrency stays at
 *   `RETENTION_WORKER_CONCURRENCY` to avoid hammering Postgres.
 * - **Failure modes:** processor errors propagate to BullMQ retry/DLQ; stalled
 *   jobs are logged at warn via the `stalled` listener.
 * - **Side effects:** see {@link runMailOutboxSweeperJob} — updates outbox rows
 *   and enqueues mail jobs.
 * - **Notes:** registered from the worker bootstrap; the returned `WorkerHandle`
 *   exposes `close()` for graceful shutdown.
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
