/** BullMQ queue that re-drives stuck organization offboardings (TEN-06). */
export const ORGANIZATION_OFFBOARDING_RECONCILE_QUEUE_NAME = 'organization-offboarding-reconcile';

/**
 * An organization offboarding whose `deletion_started_at` is older than this, with
 * `deleted_at` still null, is considered stuck and re-driven. Wide enough that an
 * in-flight delete request is never re-driven concurrently with itself.
 */
export const ORGANIZATION_OFFBOARDING_STUCK_AFTER_MINUTES = 30;

/** Max stuck offboardings re-driven per tick (bounds worst-case Stripe/S3 calls). */
export const ORGANIZATION_OFFBOARDING_RECONCILE_BATCH = 50;
