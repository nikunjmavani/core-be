import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { AUDIT_RETENTION_QUEUE_NAME } from '@/domains/audit/workers/audit-retention.constants.js';
import { runAuditRetentionJob } from '@/domains/audit/workers/audit-retention.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * BullMQ worker that deletes audit logs older than the configured retention period.
 * Repeatable schedule is registered in `src/infrastructure/queue/scheduler.ts`.
 */
export function createAuditRetentionWorker(): WorkerHandle {
  const worker = new Worker(
    AUDIT_RETENTION_QUEUE_NAME,
    async () =>
      withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
        runAuditRetentionJob(databaseHandle),
      ),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: AUDIT_RETENTION_QUEUE_NAME }, 'audit-retention.stalled');
  });

  return buildWorkerHandle(worker, AUDIT_RETENTION_QUEUE_NAME);
}
