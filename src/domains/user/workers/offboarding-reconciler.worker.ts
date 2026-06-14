import { Worker } from 'bullmq';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { runOffboardingReconcilerJob } from '@/domains/user/workers/offboarding-reconciler.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { OFFBOARDING_RECONCILER_QUEUE_NAME } from './offboarding-reconciler.constants.js';

/**
 * Construct the BullMQ {@link Worker} that detects and alerts on stuck user-offboarding workflows
 * (audit-#15).
 *
 * @remarks
 * - **Algorithm:** every scheduled tick wraps {@link runOffboardingReconcilerJob} in
 *   `withGlobalRetentionCleanupDatabaseContext` so the read scan runs against the global retention
 *   session (no per-tenant RLS), surfacing offboarding workflows that stamped `deletion_started_at`
 *   but never completed.
 * - **Failure modes:** Postgres errors propagate to BullMQ retries / DLQ; `stalled` events are
 *   warn-logged. The job never mutates the workflow (alert-only).
 * - **Side effects:** Sentry warning + structured log when stuck workflows exist; drains the Redis
 *   lease.
 * - **Notes:** retention concurrency from `RETENTION_WORKER_CONCURRENCY`; the repeatable schedule
 *   is registered in `src/infrastructure/queue/scheduler.ts` — never wire workers directly in
 *   `bootstrap.ts`.
 */
export function createOffboardingReconcilerWorker(): WorkerHandle {
  const worker = new Worker(
    OFFBOARDING_RECONCILER_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runOffboardingReconcilerJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn(
      { jobId, queue: OFFBOARDING_RECONCILER_QUEUE_NAME },
      'offboarding-reconciler.stalled',
    );
  });

  return buildWorkerHandle(worker, OFFBOARDING_RECONCILER_QUEUE_NAME);
}
