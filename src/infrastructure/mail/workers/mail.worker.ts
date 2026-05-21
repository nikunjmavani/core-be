import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { processMailOutboxJob } from '@/infrastructure/mail/workers/mail.processor.js';
import {
  MAIL_QUEUE_MAX_ATTEMPTS,
  MAIL_QUEUE_NAME,
  type MailJobData,
} from '@/infrastructure/mail/queues/mail.queue.js';
import { mailBackoffStrategy } from '@/infrastructure/mail/queues/mail-backoff.util.js';
import { mailJobDataSchema } from '@/infrastructure/mail/queues/mail.job.schema.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import { getWorkerConcurrencyMail } from '@/shared/config/worker-concurrency.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/**
 * Creates a BullMQ worker that processes email send jobs.
 */
export function createMailWorker(): WorkerHandle {
  const worker = new Worker<MailJobData>(
    MAIL_QUEUE_NAME,
    async (job) => {
      const { requestId } = parseBullMQJobData(mailJobDataSchema, job.data, MAIL_QUEUE_NAME);
      return processMailOutboxJob(
        job.data,
        omitUndefined({
          jobId: job.id,
          requestId,
          jobAttemptNumber: job.attemptsMade,
          maxJobAttempts: job.opts.attempts ?? MAIL_QUEUE_MAX_ATTEMPTS,
        }),
      );
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: getWorkerConcurrencyMail(),
      ...getDefaultWorkerOptions(),
      settings: {
        backoffStrategy: mailBackoffStrategy,
      },
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: MAIL_QUEUE_NAME }, 'mail.worker.stalled');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job?.id }, 'mail.worker.completed');
  });

  return buildWorkerHandle(worker, MAIL_QUEUE_NAME);
}
