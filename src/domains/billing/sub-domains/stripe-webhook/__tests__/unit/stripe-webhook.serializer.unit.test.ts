import { describe, expect, it } from 'vitest';
import { serializeStripeWebhookAcknowledgement } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.serializer.js';

/**
 * Small, but it is the literal body Stripe reads when deciding whether a webhook was delivered.
 * The route is one of the two exemptions from the POST→201 policy precisely so this stays a plain
 * 200 `{ received: true }`. Anything else in the body — an error string, a leaked event id — goes
 * out to a third party on every webhook, so the shape is pinned rather than assumed.
 */
describe('stripe-webhook.serializer', () => {
  it('returns exactly the acknowledgement Stripe expects', () => {
    expect(serializeStripeWebhookAcknowledgement()).toEqual({ received: true });
  });

  it('emits `received` as a boolean true, not a truthy value', () => {
    expect(serializeStripeWebhookAcknowledgement().received).toBe(true);
  });

  it('emits no other keys', () => {
    expect(Object.keys(serializeStripeWebhookAcknowledgement())).toEqual(['received']);
  });

  it('returns a fresh object each call, so a caller cannot mutate a shared singleton', () => {
    const first = serializeStripeWebhookAcknowledgement();
    const second = serializeStripeWebhookAcknowledgement();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
