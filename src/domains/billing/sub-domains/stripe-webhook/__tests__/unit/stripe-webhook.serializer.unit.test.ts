import { describe, expect, it } from 'vitest';
import { serializeStripeWebhookAcknowledgement } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.serializer.js';

/**
 * This body is what Stripe reads to decide whether to retry a delivery, so its shape is part of
 * the integration contract rather than cosmetic. It also must never grow: the webhook endpoint
 * is PUBLIC (signature-verified, but unauthenticated), so anything added here is readable by
 * anyone who can forge a request to the endpoint.
 */
describe('stripe-webhook.serializer', () => {
  it('returns exactly the { received: true } acknowledgement Stripe expects', () => {
    expect(serializeStripeWebhookAcknowledgement()).toEqual({ received: true });
  });

  it('exposes no key other than `received`', () => {
    expect(Object.keys(serializeStripeWebhookAcknowledgement())).toEqual(['received']);
  });

  it('is snake_case-clean and carries no internal ids', () => {
    const body = serializeStripeWebhookAcknowledgement() as unknown as Record<string, unknown>;

    expect(Object.keys(body).some((key) => /[A-Z]/.test(key))).toBe(false);
    for (const leakedKey of ['id', 'event_id', 'stripe_event_id', 'organization_id']) {
      expect(body).not.toHaveProperty(leakedKey);
    }
  });

  it('returns a fresh object per call (no shared mutable singleton)', () => {
    // The controller sends this straight to `reply.send`. A shared frozen-ish singleton would
    // let one request's post-processing mutate the body every later request replies with.
    const first = serializeStripeWebhookAcknowledgement();
    const second = serializeStripeWebhookAcknowledgement();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
