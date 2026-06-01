import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { runCommitDispatchRecoveryJob } from '@/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.processor.js';
import { COMMIT_DISPATCH_RECOVERY_QUEUE_NAME } from '@/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * BullMQ worker that replays crash-lost durable post-commit dispatch tasks from Redis.
 *
 * @remarks
 * - **Algorithm:** delegates to {@link runCommitDispatchRecoveryJob} on each scheduled tick.
 * - **Failure modes:** processor errors propagate to BullMQ retry/DLQ handling.
 * - **Side effects:** see {@link runCommitDispatchRecoveryJob}.
 * - **Notes:** registered from worker bootstrap; cron in `scheduler.ts`.
 */
export function createCommitDispatchRecoveryWorker(): WorkerHandle {
  const worker = new Worker(
    COMMIT_DISPATCH_RECOVERY_QUEUE_NAME,
    async () => runCommitDispatchRecoveryJob(),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: COMMIT_DISPATCH_RECOVERY_QUEUE_NAME },
      'commit-dispatch-recovery.stalled',
    );
  });

  return buildWorkerHandle(worker, COMMIT_DISPATCH_RECOVERY_QUEUE_NAME);
}
