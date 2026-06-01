import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  getRetentionWorkerOptions,
  RETENTION_WORKER_CONCURRENCY,
} from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { AUDIT_EXPORT_QUEUE_NAME } from '@/domains/audit/workers/audit-export.constants.js';
import { runAuditExportJob } from '@/domains/audit/workers/audit-export.processor.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { runGlobalRetentionWorkerJob } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';

/**
 * Creates and starts the BullMQ worker that runs the daily S3 audit export.
 *
 * @remarks
 * Wraps {@link runAuditExportJob} in `runGlobalRetentionWorkerJob` so the
 * worker uses the dedicated retention database role (no tenant context) and
 * logs / Sentry-reports failures via the central pipeline. Uses the shared
 * retention worker options (long stall window, low concurrency) because the
 * job is long-running and storage-bound; running multiple in parallel offers
 * no benefit and inflates S3 cost.
 *
 * Stalled-job warnings are routed to the structured logger with the job id so
 * operators can correlate with BullMQ stall metrics.
 */
export function createAuditExportWorker(): WorkerHandle {
  const worker = new Worker(
    AUDIT_EXPORT_QUEUE_NAME,
    async () => runGlobalRetentionWorkerJob((databaseHandle) => runAuditExportJob(databaseHandle)),
    {
      connection: getBullMQConnectionOptions(),
      concurrency: RETENTION_WORKER_CONCURRENCY,
      ...getRetentionWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: AUDIT_EXPORT_QUEUE_NAME }, 'audit-export.stalled');
  });

  return buildWorkerHandle(worker, AUDIT_EXPORT_QUEUE_NAME);
}
