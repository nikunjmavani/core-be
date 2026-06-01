import { z } from 'zod';
import { UnrecoverableError, type Job } from 'bullmq';
import { recordDeadLetterFailure } from '@/infrastructure/queue/dlq/dead-letter.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Inputs for {@link parseJobDataOrDeadLetter} — schema, the live BullMQ job, and queue name. */
export interface ParseJobDataOrDeadLetterOptions<T> {
  schema: z.ZodType<T>;
  job: Job;
  queueName: string;
}

/**
 * Validates a BullMQ job payload at the worker boundary, routing poison messages straight to
 * the dead-letter queue instead of burning the retry budget.
 *
 * @remarks
 * - **Algorithm:** `schema.safeParse(job.data)`. On success returns the parsed payload. On
 *   failure builds a `bullmq.invalid_job_payload:<queue>` error, records the dead-letter via
 *   {@link recordDeadLetterFailure} (durable Postgres row + best-effort Redis mirror), then
 *   throws BullMQ's {@link UnrecoverableError} so the remaining attempts are skipped — a
 *   malformed payload can never succeed, so retrying with backoff only wastes worker time.
 * - **Failure modes:** always throws `UnrecoverableError` on a parse failure; the
 *   `attachDeadLetterAndAlerting` `failed` listener recognises that error and does not record a
 *   second dead-letter. {@link recordDeadLetterFailure} never rejects, so a degraded
 *   Postgres/Redis cannot turn a poison message back into a retryable one.
 * - **Side effects:** on poison input, one structured `queue.job.poison_payload` log line plus
 *   the dead-letter writes; no side effects on valid input.
 * - **Notes:** call this at every worker processing entry point that reads `job.data`. The
 *   producer-side `parseBullMQJobData` keeps throwing a plain error because the enqueue path is
 *   not a retry path.
 */
export async function parseJobDataOrDeadLetter<T>({
  schema,
  job,
  queueName,
}: ParseJobDataOrDeadLetterOptions<T>): Promise<T> {
  const parsed = schema.safeParse(job.data);
  if (parsed.success) {
    return parsed.data;
  }

  const fieldErrors = z.flattenError(parsed.error).fieldErrors;
  const error = new UnrecoverableError(
    `bullmq.invalid_job_payload:${queueName}:${JSON.stringify(fieldErrors)}`,
  );

  logger.error(
    {
      queue: queueName,
      jobId: job.id,
      jobName: job.name,
      fieldErrors,
    },
    'queue.job.poison_payload',
  );

  await recordDeadLetterFailure(queueName, job, error);

  throw error;
}
