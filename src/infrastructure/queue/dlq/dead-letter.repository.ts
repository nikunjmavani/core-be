import { database } from '@/infrastructure/database/connection.js';
import { dead_letter_jobs } from '@/infrastructure/queue/dlq/dead-letter.schema.js';

/**
 * Values inserted into `audit.dead_letter_jobs` for one terminal job failure. Mirrors
 * the columns of {@link dead_letter_jobs}; `payload_summary` must already be a redacted
 * metadata summary (never raw secrets, HTML, or full webhook bodies).
 */
export interface DeadLetterJobInsert {
  source_queue: string;
  dead_letter_queue: string;
  job_id: string | null;
  job_name: string;
  payload_summary: Record<string, unknown>;
  failed_reason: string;
  error_stack: string | null;
  attempts_made: number;
  max_attempts: number;
  failed_at: Date;
}

/**
 * Inserts one append-only dead-letter record into `audit.dead_letter_jobs` — the durable
 * source of truth operators replay from after a job exhausts its BullMQ retries.
 *
 * @remarks
 * - **Algorithm:** a single `INSERT` against the process-wide base {@link database}
 *   handle. Worker failure hooks run outside any request/worker database context, so this
 *   infra-level write uses the base connection directly and passes every identifier
 *   explicitly (no RLS session reliance).
 * - **Failure modes:** propagates any Postgres error to the caller
 *   ({@link attachDeadLetterAndAlerting}), which captures it to Sentry rather than letting
 *   it escape the `failed` listener. The connection role is a member of `core_be_app`, so
 *   the table's deny-all + `core_be_app` RLS policies permit the write.
 * - **Side effects:** appends one immutable row; never updates or deletes existing rows.
 * - **Notes:** does not store raw payloads — callers pass a redacted `payload_summary`.
 */
export async function insertDeadLetterJob(record: DeadLetterJobInsert): Promise<void> {
  await database.insert(dead_letter_jobs).values({
    source_queue: record.source_queue,
    dead_letter_queue: record.dead_letter_queue,
    job_id: record.job_id,
    job_name: record.job_name,
    payload_summary: record.payload_summary,
    failed_reason: record.failed_reason,
    error_stack: record.error_stack,
    attempts_made: record.attempts_made,
    max_attempts: record.max_attempts,
    failed_at: record.failed_at,
  });
}
