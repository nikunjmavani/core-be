import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { getWorkerConcurrencyNotify } from '@/shared/config/worker-concurrency.util.js';
import { USER_DATA_EXPORT_QUEUE_NAME } from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.queue.js';
import { userDataExportJobDataSchema } from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.job.schema.js';
import { runUserDataExportJob } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export.processor.js';
import type { UserDataExportService } from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { parseJobDataOrDeadLetter } from '@/infrastructure/queue/dlq/poison-job.util.js';
import { runWithPropagatedTraceContext } from '@/infrastructure/observability/tracing/trace-context.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Construct the BullMQ {@link Worker} that drains the `user-data-export` queue.
 *
 * @remarks
 * - **Algorithm:** for each job, validates the payload with {@link userDataExportJobDataSchema},
 *   then delegates to {@link runUserDataExportJob}.
 * - **Failure modes:** schema parse errors and unexpected exceptions propagate to BullMQ, which
 *   applies the queue's retry/backoff and DLQ policy; cancellation is handled in the processor.
 * - **Side effects:** consumes Redis, writes Postgres + S3, and logs `stalled` events.
 * - **Notes:** concurrency comes from `getWorkerConcurrencyNotify` (shared with notification
 *   delivery); registered via `worker-registration.registry.ts`, never wired directly in
 *   `bootstrap.ts`.
 */
export function createUserDataExportWorker(
  userDataExportService: UserDataExportService,
): WorkerHandle {
  const worker = new Worker(
    USER_DATA_EXPORT_QUEUE_NAME,
    async (job) => {
      const jobData = await parseJobDataOrDeadLetter({
        schema: userDataExportJobDataSchema,
        job,
        queueName: USER_DATA_EXPORT_QUEUE_NAME,
      });
      await runWithPropagatedTraceContext(
        { traceparent: jobData.traceparent, tracestate: jobData.tracestate },
        job.name,
        () => runUserDataExportJob(jobData, userDataExportService),
      );
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: getWorkerConcurrencyNotify(),
      ...getDefaultWorkerOptions(),
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: USER_DATA_EXPORT_QUEUE_NAME }, 'user-data-export.worker.stalled');
  });

  return buildWorkerHandle(worker, USER_DATA_EXPORT_QUEUE_NAME);
}
