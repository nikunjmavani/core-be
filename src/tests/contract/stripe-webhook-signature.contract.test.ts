import { describe, expect, test } from 'vitest';
import Stripe from 'stripe';

import { constructStripeWebhookEvent } from '@/infrastructure/payment/stripe.client.js';
import { env } from '@/shared/config/env.config.js';

import webhookSubscriptionCreatedBaseline from './fixtures/stripe/events/customer.subscription.created.json' with {
  type: 'json',
};
import { buildStripeWebhookTestSignatureHeader } from './helpers/stripe-signature.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';

registerThirdPartyContractTestIsolationHooks();

/**
 * Inbound Stripe webhook signature verification — the security half of the ingress contract.
 *
 * @remarks
 * The sibling `stripe-webhook.contract.test.ts` covers what a *valid* event does to the
 * subscription ledger. This file covers what must happen to an *invalid* one: every path by which
 * a forged, replayed, or re-encoded payload could reach the handler has to be closed. These are the
 * cases an attacker controls, so each is asserted explicitly rather than inferred from the happy
 * path.
 *
 * Real Stripe SDK crypto against the real configured secret — no mock, no network.
 */
const RAW_PAYLOAD = JSON.stringify(webhookSubscriptionCreatedBaseline);

function signingSecret(): string {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required for the signature contract');
  // The env supports a comma-separated rotation list; the first entry is the active secret.
  return secret.split(',')[0]?.trim() ?? secret;
}

describe('Stripe webhook signature verification contract', () => {
  test('accepts a payload signed with the configured secret', () => {
    const signature = buildStripeWebhookTestSignatureHeader({
      rawPayload: RAW_PAYLOAD,
      webhookSigningSecret: signingSecret(),
    });

    const event = constructStripeWebhookEvent(RAW_PAYLOAD, signature);

    expect(event.type).toBe('customer.subscription.created');
    expect(event.id).toBe((webhookSubscriptionCreatedBaseline as { id: string }).id);
  });

  test('rejects a body tampered with after signing', () => {
    const signature = buildStripeWebhookTestSignatureHeader({
      rawPayload: RAW_PAYLOAD,
      webhookSigningSecret: signingSecret(),
    });
    // Flip a value an attacker would care about — promoting a trialing subscription to active —
    // leaving the signature untouched.
    const tampered = RAW_PAYLOAD.replace('"status":"trialing"', '"status":"active"');

    // Guard the guard: if the fixture ever stops carrying this field the replace becomes a no-op
    // and the assertion below would pass for the wrong reason.
    expect(tampered).not.toBe(RAW_PAYLOAD);
    expect(() => constructStripeWebhookEvent(tampered, signature)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  test('rejects a payload signed with a different secret', () => {
    const signature = buildStripeWebhookTestSignatureHeader({
      rawPayload: RAW_PAYLOAD,
      webhookSigningSecret: 'whsec_an_attacker_controlled_secret_at_least_32_chars_long',
    });

    expect(() => constructStripeWebhookEvent(RAW_PAYLOAD, signature)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  test('rejects a signature older than the tolerance window (replay defence)', () => {
    const toleranceSeconds = env.STRIPE_WEBHOOK_TOLERANCE_SECONDS;
    const staleTimestamp = Math.floor(Date.now() / 1000) - (toleranceSeconds + 60);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: RAW_PAYLOAD,
      secret: signingSecret(),
      timestamp: staleTimestamp,
    });

    expect(() => constructStripeWebhookEvent(RAW_PAYLOAD, signature)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  test('accepts a signature inside the tolerance window', () => {
    // Guards the boundary from the other side: the replay check must not be so tight that a
    // legitimately delayed delivery is dropped.
    const withinWindow = Math.floor(Date.now() / 1000) - 5;
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: RAW_PAYLOAD,
      secret: signingSecret(),
      timestamp: withinWindow,
    });

    expect(constructStripeWebhookEvent(RAW_PAYLOAD, signature).type).toBe(
      'customer.subscription.created',
    );
  });

  test('rejects a missing or malformed signature header', () => {
    for (const header of ['', 'not-a-signature', 't=1,v1=deadbeef']) {
      expect(() => constructStripeWebhookEvent(RAW_PAYLOAD, header)).toThrow();
    }
  });

  test('rejects a re-encoded body — the raw bytes must survive to verification', () => {
    const signature = buildStripeWebhookTestSignatureHeader({
      rawPayload: RAW_PAYLOAD,
      webhookSigningSecret: signingSecret(),
    });
    // Any middleware that parses and re-serialises JSON before verification breaks the signature.
    // This is the regression that raw-body preservation exists to prevent.
    const reEncoded = JSON.stringify(JSON.parse(RAW_PAYLOAD), null, 2);

    expect(reEncoded).not.toBe(RAW_PAYLOAD);
    expect(() => constructStripeWebhookEvent(reEncoded, signature)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  test('verifies a Buffer body identically to a string body', () => {
    const signature = buildStripeWebhookTestSignatureHeader({
      rawPayload: RAW_PAYLOAD,
      webhookSigningSecret: signingSecret(),
    });

    expect(constructStripeWebhookEvent(Buffer.from(RAW_PAYLOAD, 'utf8'), signature).id).toBe(
      constructStripeWebhookEvent(RAW_PAYLOAD, signature).id,
    );
  });

  test('rejects a signature computed over a different payload', () => {
    const otherPayload = JSON.stringify({
      ...(webhookSubscriptionCreatedBaseline as Record<string, unknown>),
      id: 'evt_a_different_event_entirely',
    });
    const signature = buildStripeWebhookTestSignatureHeader({
      rawPayload: otherPayload,
      webhookSigningSecret: signingSecret(),
    });

    expect(() => constructStripeWebhookEvent(RAW_PAYLOAD, signature)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });
});
