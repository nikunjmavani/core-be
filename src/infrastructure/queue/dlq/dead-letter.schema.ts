import { sql } from 'drizzle-orm';
import { bigserial, index, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { auditSchema } from '@/infrastructure/database/pg-schemas.js';

/**
 * Drizzle table for the durable dead-letter ledger (`audit.dead_letter_jobs`). When a
 * BullMQ job exhausts its retry budget the final-failure hook writes one append-only
 * row here as the **source of truth** operators replay from; the `<source>-dlq` Redis
 * queue is only a convenience mirror. Persisting to Postgres first means a degraded
 * Redis (the common cause of the failures themselves) cannot also drop the record.
 *
 * @remarks
 * - **Append-only:** rows are never updated — each terminal failure (including a failed
 *   replay) is its own immutable record, so there is no `updated_at` (mirrors the audit
 *   log convention).
 * - **No secrets:** `payload_summary` carries a hand-picked metadata summary only; raw
 *   job payloads, HTML bodies, and full webhook bodies are intentionally excluded.
 * - **Schema choice:** lives in the `audit` Postgres schema (operational failure record),
 *   infra-owned, not tenant-scoped; defense-in-depth RLS (deny-all + `core_be_app`) is
 *   applied in the migration like other system tables.
 */
export const dead_letter_jobs = auditSchema.table(
  'dead_letter_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source_queue: text('source_queue').notNull(),
    dead_letter_queue: text('dead_letter_queue').notNull(),
    job_id: text('job_id'),
    job_name: text('job_name').notNull(),
    payload_summary: jsonb('payload_summary').notNull(),
    failed_reason: text('failed_reason').notNull(),
    error_stack: text('error_stack'),
    attempts_made: integer('attempts_made').notNull(),
    max_attempts: integer('max_attempts').notNull(),
    failed_at: timestamp('failed_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Stamped by the auto-retry sweeper once a row's retry budget is exhausted (or it is otherwise
    // resolved). NULL = still auto-retry-eligible. Filtered out of the scan so exhausted rows can
    // never permanently block the head of the queue or replay again after the Redis budget expires.
    auto_retry_resolved_at: timestamp('auto_retry_resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_dead_letter_jobs_source_queue_failed_at').on(table.source_queue, table.failed_at),
    index('idx_dead_letter_jobs_failed_at').on(table.failed_at),
    // sec-Q #31 / sec-D #31: partial index for the auto-retry sweep, which filters
    // `WHERE auto_retry_resolved_at IS NULL`. Keeps the working set bounded to
    // unresolved rows so the planner does not walk the resolved tail on every
    // tick. Added by migration 20260607030000.
    index('idx_dead_letter_jobs_unresolved_source_failed_at')
      .on(table.source_queue, table.failed_at)
      .where(sql`${table.auto_retry_resolved_at} IS NULL`),
  ],
);
