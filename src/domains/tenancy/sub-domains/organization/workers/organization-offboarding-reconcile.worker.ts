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
  runOrganizationOffboardingReconcileJob,
  type OrganizationOffboardingReconcileService,
} from './organization-offboarding-reconcile.processor.js';
import { ORGANIZATION_OFFBOARDING_RECONCILE_QUEUE_NAME } from './organization-offboarding-reconcile.constants.js';

/**
 * Constructs the BullMQ worker that re-drives stuck organization offboardings
 * (TEN-06).
 *
 * @remarks
 * - **Algorithm:** each scheduled tick runs
 *   {@link runOrganizationOffboardingReconcileJob}, which scans for stalled
 *   offboardings and calls `resumeOffboarding` per row.
 * - **Failure modes:** per-row failures are counted inside the job; scan errors
 *   propagate to BullMQ retry / DLQ; `stalled` events are warn-logged.
 * - **Side effects:** completes the full organization offboarding side effects for
 *   each stuck row.
 * - **Notes:** retention concurrency; repeatable schedule registered in
 *   `infrastructure/queue/scheduler.ts`.
 */
export function createOrganizationOffboardingReconcileWorker(
  service: OrganizationOffboardingReconcileService,
): WorkerHandle {
  const worker = new Worker(
    ORGANIZATION_OFFBOARDING_RECONCILE_QUEUE_NAME,
    async () => runOrganizationOffboardingReconcileJob(service),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: ORGANIZATION_OFFBOARDING_RECONCILE_QUEUE_NAME },
      'organization-offboarding-reconcile.stalled',
    );
  });

  return buildWorkerHandle(worker, ORGANIZATION_OFFBOARDING_RECONCILE_QUEUE_NAME);
}
