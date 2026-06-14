import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  runUserOffboardingReconcileJob,
  type UserOffboardingReconcileService,
} from './user-offboarding-reconcile.processor.js';
import { USER_OFFBOARDING_RECONCILE_QUEUE_NAME } from './user-offboarding-reconcile.constants.js';

/**
 * Constructs the BullMQ worker that re-drives stuck user offboardings
 * (USER-04 / USER-09).
 *
 * @remarks
 * - **Algorithm:** each scheduled tick runs {@link runUserOffboardingReconcileJob},
 *   which scans for stalled offboardings and calls `resumeOffboarding` per row.
 * - **Failure modes:** per-row failures are counted inside the job; scan errors
 *   propagate to BullMQ retry / DLQ; `stalled` events are warn-logged.
 * - **Side effects:** completes the full user offboarding side effects for each
 *   stuck row.
 * - **Notes:** retention concurrency; repeatable schedule registered in
 *   `infrastructure/queue/scheduler.ts`.
 */
export function createUserOffboardingReconcileWorker(
  service: UserOffboardingReconcileService,
): WorkerHandle {
  const worker = new Worker(
    USER_OFFBOARDING_RECONCILE_QUEUE_NAME,
    async () => runUserOffboardingReconcileJob(service),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: USER_OFFBOARDING_RECONCILE_QUEUE_NAME },
      'user-offboarding-reconcile.stalled',
    );
  });

  return buildWorkerHandle(worker, USER_OFFBOARDING_RECONCILE_QUEUE_NAME);
}
