/** Shared BullMQ job-options policy applied across event-driven domain producer queues. */

/**
 * Completed/failed BullMQ jobs retained per event-driven domain queue (count cap).
 *
 * @remarks
 * Bounds how many finished jobs each producer queue (`stripe-webhook`, `notification`,
 * `webhook-delivery`, `user-data-export`, `mail`) keeps in Redis for observability before
 * eviction; paired with the seven-day (`SEVEN_DAYS_SECONDS`) age cap at each call site. This is
 * the default for high-throughput domain queues — the scheduler's repeatable jobs and the
 * dead-letter queue intentionally use their own counts/ages and do not consume this value.
 */
export const DEFAULT_JOB_RETENTION_COUNT = 1_000;
