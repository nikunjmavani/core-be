import Stripe from 'stripe';

/**
 * Mints a real `Stripe-Signature` header for `rawPayload` using the SDK's canonical test helper.
 *
 * @remarks
 * Pass `timestampSeconds` to sign the payload as of a specific moment — the only way to build a
 * signature that is cryptographically **valid** but outside `STRIPE_WEBHOOK_TOLERANCE_SECONDS`,
 * which is what a replayed delivery looks like. Omitted, the SDK signs as of now.
 */
export function buildStripeWebhookTestSignatureHeader(parameters: {
  rawPayload: string;
  webhookSigningSecret: string;
  timestampSeconds?: number;
}): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: parameters.rawPayload,
    secret: parameters.webhookSigningSecret,
    ...(parameters.timestampSeconds !== undefined
      ? { timestamp: parameters.timestampSeconds }
      : {}),
  });
}
