import Stripe from 'stripe';

export function buildStripeWebhookTestSignatureHeader(parameters: {
  rawPayload: string;
  webhookSigningSecret: string;
}): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: parameters.rawPayload,
    secret: parameters.webhookSigningSecret,
  });
}
