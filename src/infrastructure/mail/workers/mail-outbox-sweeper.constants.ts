/** BullMQ queue name — repeatable schedule: `src/infrastructure/queue/scheduler.ts`. */
export const MAIL_OUTBOX_SWEEPER_QUEUE_NAME = 'mail-outbox-sweeper';

/**
 * Multiplier applied to the `sending`-reclaim window when the Resend circuit breaker is OPEN.
 * Rows stuck in `sending` while Resend is down are stuck *because* the provider is failing, not
 * because the job was lost — reclaiming and re-enqueuing them just amplifies load on an already
 * struggling provider. Widening the window holds them until the circuit recovers.
 */
export const MAIL_OUTBOX_RECLAIM_CIRCUIT_OPEN_MULTIPLIER = 2;
