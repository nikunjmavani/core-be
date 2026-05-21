/**
 * Ack body returned to Stripe after a successful enqueue.
 * Stripe only needs a 2xx — `received: true` keeps the contract explicit for clients/observers.
 */
export interface StripeWebhookAcknowledgement {
  received: boolean;
}
