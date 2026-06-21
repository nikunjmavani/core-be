/** Billing and Stripe integration defaults. */

/** BullMQ jobs stuck in `sending` / `processing` may be reclaimed after this lease (minutes). */
export const STUCK_SENDING_LEASE_MINUTES = 15;

/** Stripe webhook events stuck in `processing` may be reclaimed after this lease (minutes). */
export const STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES = STUCK_SENDING_LEASE_MINUTES;

/**
 * Upper bound on the failed-event tally surfaced by the reclaim worker's
 * `stripe_webhook_events_failed_count` gauge (audit #15). The count query stops
 * scanning at this many `failed` rows so a pathological backlog (e.g. a
 * prolonged Stripe outage that fails millions of events) can never turn the
 * periodic gauge refresh into an unbounded sequential scan. The gauge only
 * drives a "failed rows are lingering" alert, so any value at or above the cap
 * is operationally equivalent.
 */
export const STRIPE_WEBHOOK_FAILED_COUNT_CAP = 10_000;
