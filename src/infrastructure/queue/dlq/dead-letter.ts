/**
 * Dead-letter queues: after a job exhausts retries, enqueue a snapshot to `<source>-dlq`
 * and emit one Sentry issue (grouped by queue + job name).
 */

import { Queue, type Job, type Worker } from 'bullmq';
import { isSentryInitialized, Sentry } from '@/infrastructure/observability/sentry/sentry.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/** Suffix appended to a source queue name to derive its dead-letter queue (`<source>-dlq`). */
export const DLQ_QUEUE_SUFFIX = '-dlq';

const DEAD_LETTER_JOB_NAME = 'dead-letter';

/**
 * Dead-letter jobs are retained for 30 days so operators have time to inspect and replay
 * them, after which BullMQ evicts the records from Redis to prevent unbounded growth and
 * OOM. Replay flows must finish (or re-enqueue) within this window.
 */
const DEAD_LETTER_RETENTION_SECONDS = 30 * 24 * 60 * 60;

const deadLetterQueuesByName = new Map<string, Queue>();

/**
 * Snapshot persisted on the `<source>-dlq` queue when a job exhausts its retry budget.
 * Carries only a hand-picked metadata summary (see {@link buildReplayJobPayload}) — the
 * original payload is intentionally not stored so secrets, HTML bodies, and full webhook
 * payloads never sit in Redis past the 30-day retention window.
 */
export interface DeadLetterJobData {
  original_queue: string;
  original_job_id?: string;
  original_job_name: string;
  replay_attempt?: number;
  /** Metadata only — never store secrets, HTML, or full webhook payloads in Redis. */
  original_data_summary: Record<string, unknown>;
  failed_reason: string;
  error_stack?: string;
  attempts_made: number;
  max_attempts: number;
  failed_at: string;
}

function summarizeJobDataForDeadLetter(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    return {};
  }
  const record = data as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (record.mailOutboxId !== undefined) summary.mail_outbox_id = record.mailOutboxId;
  if (record.deliveryAttemptId !== undefined) {
    summary.delivery_attempt_id = record.deliveryAttemptId;
  }
  if (record.webhookId !== undefined) summary.webhook_id = record.webhookId;
  if (record.eventType !== undefined) summary.event_type = record.eventType;
  if (record.notificationId !== undefined) summary.notification_id = record.notificationId;
  return summary;
}

/** Resolves the BullMQ dead-letter queue name (`<source>-dlq`) for a source queue. */
export function getDeadLetterQueueName(sourceQueueName: string): string {
  return `${sourceQueueName}${DLQ_QUEUE_SUFFIX}`;
}

/** Batch variant of {@link getDeadLetterQueueName}, used by the dashboard and DLQ replay tool. */
export function listDeadLetterQueueNames(sourceQueueNames: readonly string[]): string[] {
  return sourceQueueNames.map((name) => getDeadLetterQueueName(name));
}

function getOrCreateDeadLetterQueue(deadLetterQueueName: string): Queue {
  const existing = deadLetterQueuesByName.get(deadLetterQueueName);
  if (existing) return existing;
  const queue = new Queue(deadLetterQueueName, {
    connection: getBullMQConnectionOptions(),
  });
  deadLetterQueuesByName.set(deadLetterQueueName, queue);
  return queue;
}

/**
 * Returns true when the job has used its last retry (BullMQ `failed` event).
 */
export function isFinalJobFailure(job: Job | undefined): boolean {
  if (!job) return false;
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

/**
 * Persists a job snapshot to `<sourceQueueName>-dlq` after the final retry has failed.
 *
 * @remarks
 * - **Algorithm:** lazily opens (or reuses) a BullMQ {@link Queue} for the DLQ, builds a
 *   safe {@link DeadLetterJobData} record via `summarizeJobDataForDeadLetter`, and adds a
 *   `dead-letter` job keyed by `dlq-<source>-<originalJobId>` for replay deduplication.
 * - **Failure modes:** any Redis error bubbles back to {@link attachDeadLetterAndAlerting},
 *   which logs `queue.dead_letter.enqueue_failed`; the original failed job remains in
 *   BullMQ's `failed` set so operators can still inspect it.
 * - **Side effects:** writes a row to the DLQ Redis stream with 30-day retention on
 *   `removeOnComplete` and `removeOnFail`; no Postgres writes.
 * - **Notes:** stable `jobId` makes repeated DLQ inserts for the same source job idempotent,
 *   so replays that fail again do not multiply DLQ entries. Never store secrets here.
 */
export async function enqueueDeadLetter(
  sourceQueueName: string,
  job: Job,
  error: Error | unknown,
): Promise<void> {
  const deadLetterQueueName = getDeadLetterQueueName(sourceQueueName);
  const queue = getOrCreateDeadLetterQueue(deadLetterQueueName);
  const errorObject = error instanceof Error ? error : new Error(String(error));
  const maxAttempts = job.opts.attempts ?? 1;

  const data: DeadLetterJobData = omitUndefined({
    original_queue: sourceQueueName,
    original_job_id: job.id ?? undefined,
    original_job_name: job.name,
    original_data_summary: summarizeJobDataForDeadLetter(job.data),
    failed_reason: errorObject.message,
    error_stack: errorObject.stack,
    attempts_made: job.attemptsMade,
    max_attempts: maxAttempts,
    failed_at: new Date().toISOString(),
  });

  const safeOriginalJobIdentifier = job.id ?? job.opts.jobId ?? 'unknown';
  const deadLetterJobIdentifier = `dlq-${sourceQueueName}-${String(safeOriginalJobIdentifier)}`;

  await queue.add(DEAD_LETTER_JOB_NAME, data, {
    jobId: deadLetterJobIdentifier,
    removeOnComplete: { age: DEAD_LETTER_RETENTION_SECONDS },
    removeOnFail: { age: DEAD_LETTER_RETENTION_SECONDS },
  });

  logger.info(
    {
      sourceQueue: sourceQueueName,
      deadLetterQueue: deadLetterQueueName,
      originalJobId: job.id,
      originalJobName: job.name,
    },
    'queue.dead_letter.enqueued',
  );
}

function captureFinalFailureInSentry(queueName: string, job: Job, error: Error | unknown): void {
  if (!isSentryInitialized()) return;

  const errorObject = error instanceof Error ? error : new Error(String(error));

  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setFingerprint(['worker_final_failure', queueName, job.name]);
    scope.setTag('queue', queueName);
    scope.setTag('job_id', String(job.id ?? 'unknown'));
    scope.setTag('job_name', job.name);
    scope.setTag('final_failure', 'true');
    Sentry.captureException(errorObject);
  });
}

/**
 * Subscribes once to `failed`: warn on transient retries; on final failure, DLQ + Sentry.
 */
export function attachDeadLetterAndAlerting(worker: Worker, queueName: string): void {
  worker.on('failed', (job, error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!job) {
      logger.error({ queue: queueName, error: errorMessage }, 'queue.job.failed_without_job');
      return;
    }

    if (!isFinalJobFailure(job)) {
      logger.warn(
        {
          queue: queueName,
          jobId: job.id,
          jobName: job.name,
          attempt: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
          error: errorMessage,
        },
        'queue.job.retry',
      );
      return;
    }

    logger.error(
      {
        queue: queueName,
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
        error: errorMessage,
      },
      'queue.job.final_failure',
    );

    void enqueueDeadLetter(queueName, job, error).catch((deadLetterError) => {
      logger.error(
        {
          deadLetterError:
            deadLetterError instanceof Error ? deadLetterError.message : String(deadLetterError),
          queue: queueName,
          jobId: job.id,
        },
        'queue.dead_letter.enqueue_failed',
      );
    });

    captureFinalFailureInSentry(queueName, job, error);
  });
}

/**
 * Closes every BullMQ DLQ producer this module has lazily created and clears the cache.
 * Called by the worker shutdown sequence so Redis connections drain cleanly. Failures are
 * swallowed via `Promise.allSettled` so one stuck queue cannot block the others.
 */
export async function closeDeadLetterQueues(): Promise<void> {
  const queues = [...deadLetterQueuesByName.values()];
  deadLetterQueuesByName.clear();
  await Promise.allSettled(queues.map((queue) => queue.close()));
}
