/** BullMQ queue for detecting + alerting on stuck user-offboarding workflows (audit-#15). */
export const OFFBOARDING_RECONCILER_QUEUE_NAME = 'offboarding-reconciler';

/**
 * A user-offboarding workflow whose `deletion_started_at` is older than this — while `deleted_at`
 * is still `NULL` — is treated as STUCK: the multi-step offboarding stamped `deletion_started_at`
 * but never reached the final soft-delete (a crash/partial failure between stages). Normal
 * offboarding completes within seconds, so a generous 1-hour threshold avoids false positives from
 * a long-but-healthy in-flight request.
 */
export const OFFBOARDING_STALE_THRESHOLD_MS = 60 * 60 * 1000;

/** Max stuck rows whose public ids are attached to the alert (the count itself is exact). */
export const OFFBOARDING_RECONCILER_SAMPLE_LIMIT = 20;
