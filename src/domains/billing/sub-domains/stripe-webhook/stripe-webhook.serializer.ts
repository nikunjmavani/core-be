import type { StripeWebhookAcknowledgement } from './stripe-webhook.types.js';

export function serializeStripeWebhookAcknowledgement(): StripeWebhookAcknowledgement {
  return { received: true };
}
