/** BullMQ queue name — repeatable schedule: `src/infrastructure/queue/scheduler.ts`. */
export const AUDIT_OUTBOX_DRAIN_QUEUE_NAME = 'audit-outbox-drain';

/** Default cron — every 30 seconds. Tunable via `AUDIT_OUTBOX_DRAIN_CRON`. */
export const DEFAULT_AUDIT_OUTBOX_DRAIN_CRON = '*/30 * * * * *';

/** Rows per drain batch. Override via `AUDIT_OUTBOX_DRAIN_BATCH_SIZE`. */
export const DEFAULT_AUDIT_OUTBOX_DRAIN_BATCH_SIZE = 500;

/** Per-row attempt cap; after this many failures the row is marked FAILED for operator triage. */
export const DEFAULT_AUDIT_OUTBOX_DRAIN_MAX_ATTEMPTS = 5;
