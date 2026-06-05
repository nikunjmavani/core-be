import { Queue } from 'bullmq';
import { getBullMQProducerConnectionOptions } from '@/infrastructure/queue/connection.js';
import { insertMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import { captureTraceContextForPropagation } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { FIFTEEN_SECONDS_MS, SEVEN_DAYS_SECONDS } from '@/shared/constants/ttl.constants.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { mailJobDataSchema, type MailJobDataValidated } from './mail.job.schema.js';

/** BullMQ queue name for outbox-driven mail send jobs (`mail/send-email`). */
export const MAIL_QUEUE_NAME = 'mail';

/** BullMQ attempts — extra headroom for Resend circuit-open deferred retries. */
export const MAIL_QUEUE_MAX_ATTEMPTS = 8;

/** Payload stored in Postgres mail_outbox; only the row id is stored in Redis. */
export type MailJobData = MailJobDataValidated;

/** Input for enqueueing — persisted to auth.mail_outbox before the BullMQ job is added. */
export interface MailEnqueueInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

let mailQueue: Queue<MailJobData> | null = null;

function getMailQueue(): Queue<MailJobData> {
  if (mailQueue) return mailQueue;
  mailQueue = new Queue<MailJobData>(MAIL_QUEUE_NAME, {
    // Shared producer options pin `enableOfflineQueue: false` so a Redis partition fails the
    // enqueue fast instead of buffering it; the explicit 15s deadline in `enqueueMailOutboxJob`
    // additionally bounds how long a single enqueue can wait during graceful shutdown.
    connection: getBullMQProducerConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: 1000, age: SEVEN_DAYS_SECONDS },
      removeOnFail: { count: 500, age: SEVEN_DAYS_SECONDS },
      attempts: MAIL_QUEUE_MAX_ATTEMPTS,
      backoff: { type: 'custom' },
    },
  });
  return mailQueue;
}

/**
 * Enqueue a BullMQ send job for an existing mail_outbox row (no new Postgres insert).
 */
export async function enqueueMailOutboxJob(
  mailOutboxId: number,
  options?: { requestId?: string },
): Promise<void> {
  let deadlineTimer: NodeJS.Timeout | undefined;
  try {
    const queue = getMailQueue();
    const jobData = parseBullMQJobData(
      mailJobDataSchema,
      omitUndefined({
        mailOutboxId,
        requestId: options?.requestId,
        ...captureTraceContextForPropagation(),
      }),
      MAIL_QUEUE_NAME,
    );
    await new Promise<void>((resolve, reject) => {
      const enqueueJobPromise = queue.add('send-email', jobData);
      deadlineTimer = setTimeout(() => {
        reject(new Error('mail.enqueue.deadline_exceeded'));
      }, FIFTEEN_SECONDS_MS);
      void enqueueJobPromise
        .then(() => {
          if (deadlineTimer) clearTimeout(deadlineTimer);
          resolve();
        })
        .catch((error: unknown) => {
          if (deadlineTimer) clearTimeout(deadlineTimer);
          reject(
            error instanceof Error ? error : new Error('mail.enqueue.failed', { cause: error }),
          );
        });
    });
  } catch (error) {
    logger.error({ error, mailOutboxId }, 'mail.enqueue.failed');
    throw error;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/**
 * Inserts a mail_outbox row using the active request transaction when present.
 * Does **not** enqueue BullMQ — pair with `dispatchOutboxEmail` via `eventBus.onCommit`
 * for HTTP flows, or call `dispatchOutboxEmail` immediately in worker runtime.
 */
export async function recordOutboxEmail(data: MailEnqueueInput): Promise<number> {
  return insertMailOutbox(data);
}

/**
 * Enqueues async delivery for an existing mail_outbox row (post-commit side effect).
 */
export async function dispatchOutboxEmail(
  mailOutboxId: number,
  options?: { requestId?: string },
): Promise<void> {
  await enqueueMailOutboxJob(mailOutboxId, options);
}

/**
 * Persist email to mail_outbox and enqueue async delivery via the mail worker.
 *
 * @deprecated Prefer `recordOutboxEmail` + `eventBus.onCommit(() => dispatchOutboxEmail(...))`
 * in HTTP handlers so BullMQ dispatch runs only after the request transaction commits.
 * Safe for worker/runtime paths without a request transaction.
 *
 * @throws when outbox insert or Redis enqueue fails (callers should handle or log).
 */
export async function enqueueEmail(
  data: MailEnqueueInput,
  options?: { requestId?: string },
): Promise<void> {
  const mailOutboxId = await recordOutboxEmail(data);
  await dispatchOutboxEmail(mailOutboxId, options);
}

/**
 * Close the mail queue connection (for graceful shutdown).
 */
export async function closeMailQueue(): Promise<void> {
  if (mailQueue) {
    await mailQueue.close();
    mailQueue = null;
  }
}
