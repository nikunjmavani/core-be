import type { StripeWebhookAcknowledgement } from './stripe-webhook.types.js';

/** Returns the `{ received: true }` payload Stripe expects for a 200 response. */
export function serializeStripeWebhookAcknowledgement(): StripeWebhookAcknowledgement {
  return { received: true };
}
