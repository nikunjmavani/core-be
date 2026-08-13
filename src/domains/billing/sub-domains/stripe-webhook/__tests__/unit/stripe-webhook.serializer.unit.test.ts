import { describe, expect, it } from 'vitest';
import { serializeStripeWebhookAcknowledgement } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.serializer.js';

/**
 * Stripe webhook acknowledgement body.
 *
 * @remarks
 * Small, but it is the reply Stripe reads to decide whether a delivery succeeded. Two properties
 * are worth pinning: the body must stay exactly `{ received: true }`, and it must carry nothing
 * else — anything derived from the event would echo Stripe's own payload back over a connection
 * that is not authenticated in that direction.
 *
 * The status code (200 rather than the usual POST 201) is enforced separately by the method-status
 * policy middleware; this covers only the body.
 */
describe('serializeStripeWebhookAcknowledgement', () => {
  it('returns the acknowledgement Stripe expects', () => {
    expect(serializeStripeWebhookAcknowledgement()).toEqual({ received: true });
  });

  it('carries exactly one key', () => {
    // A webhook acknowledgement must not become a place to leak processing detail; Stripe logs
    // and displays this body in the dashboard.
    expect(Object.keys(serializeStripeWebhookAcknowledgement())).toEqual(['received']);
  });

  it('sets received to boolean true, not a truthy value', () => {
    const acknowledgement = serializeStripeWebhookAcknowledgement();

    expect(acknowledgement.received).toBe(true);
    expect(typeof acknowledgement.received).toBe('boolean');
  });

  it('takes no arguments, so no event data can reach the body', () => {
    // Structural guarantee rather than a runtime one: with no parameters there is nothing from the
    // inbound event to echo back.
    expect(serializeStripeWebhookAcknowledgement).toHaveLength(0);
  });

  it('returns a fresh object each call', () => {
    // A shared mutable singleton could be altered by one handler and observed by the next.
    const first = serializeStripeWebhookAcknowledgement();
    const second = serializeStripeWebhookAcknowledgement();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('serialises to the exact JSON Stripe receives', () => {
    expect(JSON.stringify(serializeStripeWebhookAcknowledgement())).toBe('{"received":true}');
  });
});
