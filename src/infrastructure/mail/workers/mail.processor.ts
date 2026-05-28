import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { sendEmail } from '@/infrastructure/mail/mail.service.js';
import { MAIL_QUEUE_MAX_ATTEMPTS } from '@/infrastructure/mail/queues/mail.queue.js';
import {
  findMailOutboxById,
  markMailOutboxFailed,
  markMailOutboxSent,
  releaseMailOutboxClaim,
  tryClaimPendingMailOutbox,
} from '@/infrastructure/mail/mail-outbox.repository.js';
import { MAIL_QUEUE_NAME, type MailJobData } from '@/infrastructure/mail/queues/mail.queue.js';
import { mailJobDataSchema } from '@/infrastructure/mail/queues/mail.job.schema.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const DEFAULT_MAIL_JOB_MAX_ATTEMPTS = MAIL_QUEUE_MAX_ATTEMPTS;

/**
 * Options forwarded from the BullMQ wrapper to {@link processMailOutboxJob} —
 * job identity, propagated request id, and the attempt counters used to detect
 * the final retry for terminal `failed` state.
 *
 * @remarks
 * - **Algorithm:** `jobAttemptNumber + 1 >= maxJobAttempts` flips the processor
 *   into "final attempt" behaviour (`markMailOutboxFailed` instead of release).
 * - **Failure modes:** undefined attempt fields default to `0` / `MAIL_QUEUE_MAX_ATTEMPTS`
 *   — pass the real BullMQ `attemptsMade` and `job.opts.attempts` from the worker.
 * - **Side effects:** none — pure data carrier.
 * - **Notes:** `requestId` is also re-parsed from the job payload so tests can
 *   omit options entirely.
 */
export type ProcessMailOutboxJobOptions = {
  jobId?: string;
  requestId?: string;
  /** Zero-based BullMQ attemptsMade for the current run. */
  jobAttemptNumber?: number;
  /** Configured BullMQ attempts (from queue defaultJobOptions). */
  maxJobAttempts?: number;
};

/**
 * Result of {@link processMailOutboxJob}: Resend message id on success, or
 * `skipped: true` when the row was already `sent` / in flight from a sibling
 * worker.
 *
 * @remarks
 * - **Algorithm:** `skipped` is set whenever the claim transition returned
 *   `already_sent` or `in_flight`; `messageId` is the Resend id either from the
 *   fresh send or the prior `sent` row.
 * - **Failure modes:** never returned on hard error — those throw to BullMQ.
 * - **Side effects:** none from the type itself.
 * - **Notes:** consumed by tests and observability assertions.
 */
export type ProcessMailOutboxJobResult = {
  messageId?: string;
  skipped?: boolean;
};

/**
 * Processes one `mail/send-email` job: claims the outbox row, calls Resend via
 * {@link sendEmail}, and finalises status.
 *
 * @remarks
 * - **Algorithm:** atomic `pending → sending` claim, send through Resend, then
 *   `markMailOutboxSent` on success. On error, releases the claim back to
 *   `pending` for retry — except on the final attempt where the row is marked
 *   `failed` so the DLQ hook fires.
 * - **Failure modes:** missing outbox row throws (unrecoverable); already-sent /
 *   in-flight short-circuit to a `skipped` result; `CircuitBreakerOpenError` is
 *   never terminal — the claim is released so BullMQ can retry past cooldown.
 * - **Side effects:** updates `auth.mail_outbox.status` / `sent_at` /
 *   `resend_message_id`; sends one HTTP request to Resend per claimed attempt;
 *   emits `mail.worker.*` structured logs.
 * - **Notes:** idempotent — duplicate jobs for the same `mailOutboxId` resolve
 *   to `skipped` once status is `sent`. Runs inside a `system_table` worker
 *   context (no tenant RLS) because `auth.mail_outbox` is not tenant-scoped.
 */
export async function processMailOutboxJob(
  jobData: MailJobData,
  options: ProcessMailOutboxJobOptions = {},
): Promise<ProcessMailOutboxJobResult> {
  return withSystemTableWorkerContext(() => processMailOutboxJobInner(jobData, options));
}

async function processMailOutboxJobInner(
  jobData: MailJobData,
  options: ProcessMailOutboxJobOptions = {},
): Promise<ProcessMailOutboxJobResult> {
  const { mailOutboxId, requestId } = parseBullMQJobData(
    mailJobDataSchema,
    jobData,
    MAIL_QUEUE_NAME,
  );
  const maxJobAttempts = options.maxJobAttempts ?? DEFAULT_MAIL_JOB_MAX_ATTEMPTS;
  const jobAttemptNumber = options.jobAttemptNumber ?? 0;
  const isFinalJobAttempt = jobAttemptNumber + 1 >= maxJobAttempts;

  const outboxRow = await findMailOutboxById(mailOutboxId);
  if (!outboxRow) {
    throw new Error(`mail.outbox.not_found:${String(mailOutboxId)}`);
  }

  const claimResult = await tryClaimPendingMailOutbox(mailOutboxId);
  if (claimResult === 'already_sent') {
    logger.info(
      {
        jobId: options.jobId,
        requestId,
        mailOutboxId,
        resendMessageId: outboxRow.resend_message_id,
      },
      'mail.worker.already_sent',
    );
    return omitUndefined({
      messageId: outboxRow.resend_message_id ?? undefined,
      skipped: true as const,
    });
  }
  if (claimResult === 'in_flight') {
    logger.info({ jobId: options.jobId, requestId, mailOutboxId }, 'mail.worker.in_flight');
    return omitUndefined({ skipped: true as const });
  }
  if (claimResult !== 'claimed') {
    throw new Error(`mail.outbox.not_claimable:${String(mailOutboxId)}:${claimResult}`);
  }

  const toAddresses = outboxRow.to_addresses as string[];
  logger.info(
    {
      jobId: options.jobId,
      requestId,
      mailOutboxId,
      recipientCount: toAddresses.length,
      jobAttemptNumber,
      maxJobAttempts,
    },
    'mail.worker.processing',
  );

  try {
    const messageId = await sendEmail(
      omitUndefined({
        to: toAddresses,
        subject: outboxRow.subject,
        html: outboxRow.html,
        text: outboxRow.text_body ?? undefined,
        replyTo: outboxRow.reply_to ?? undefined,
        tags: (outboxRow.tags as { name: string; value: string }[] | null) ?? undefined,
      }),
    );

    await markMailOutboxSent(mailOutboxId, messageId);
    logger.info(
      {
        jobId: options.jobId,
        requestId,
        mailOutboxId,
        resendMessageId: messageId,
      },
      'email.sent',
    );
    return { messageId };
  } catch (error) {
    const isCircuitOpen = error instanceof CircuitBreakerOpenError;
    if (isFinalJobAttempt && !isCircuitOpen) {
      await markMailOutboxFailed(mailOutboxId);
    } else {
      await releaseMailOutboxClaim(mailOutboxId);
    }
    if (isCircuitOpen) {
      logger.warn(
        {
          jobId: options.jobId,
          requestId,
          mailOutboxId,
          circuit: error.circuitName,
          retryAfterMs: error.retryAfterMs,
          jobAttemptNumber,
          maxJobAttempts,
        },
        'mail.worker.circuit_open',
      );
    }
    throw error instanceof Error
      ? error
      : new Error(`mail.send.failed:outbox:${String(mailOutboxId)}`);
  }
}
