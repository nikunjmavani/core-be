/** Billing and Stripe integration defaults. */

/** BullMQ jobs stuck in `sending` / `processing` may be reclaimed after this lease (minutes). */
export const STUCK_SENDING_LEASE_MINUTES = 15;

/** Stripe webhook events stuck in `processing` may be reclaimed after this lease (minutes). */
export const STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES = STUCK_SENDING_LEASE_MINUTES;
