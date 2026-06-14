/** BullMQ queue that re-drives stuck user account offboardings (USER-04 / USER-09). */
export const USER_OFFBOARDING_RECONCILE_QUEUE_NAME = 'user-offboarding-reconcile';

/**
 * A user offboarding whose `deletion_started_at` is older than this, with
 * `deleted_at` still null, is considered stuck and re-driven. Wide enough that an
 * in-flight delete request is never re-driven concurrently with itself.
 */
export const USER_OFFBOARDING_STUCK_AFTER_MINUTES = 30;

/** Max stuck offboardings re-driven per tick (bounds worst-case external calls). */
export const USER_OFFBOARDING_RECONCILE_BATCH = 50;
