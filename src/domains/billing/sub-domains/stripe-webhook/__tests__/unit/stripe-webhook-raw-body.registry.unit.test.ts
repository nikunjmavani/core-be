import { describe, expect, it } from 'vitest';
import {
  isStripeWebhookRawBodyRoute,
  listStripeWebhookRawBodyRoutes,
  registerStripeWebhookRawBodyRoute,
} from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-raw-body.registry.js';

/**
 * The registry has three exports and, until now, no dedicated test — even though Stripe HMAC
 * signature verification **cannot work** without it. `stripe-webhook-ingress.policy.unit.test.ts`
 * pins the ingress plugin that reads this registry, but nothing pinned the registry itself.
 *
 * The set is deliberately process-global (the routes module fills it at registration time and
 * the content-type parser in `src/app.ts` reads it per request), so every case below uses a
 * unique sentinel URL and asserts membership rather than exact set equality — a suite that also
 * builds the app would otherwise see the real webhook URL in the same set.
 */
describe('stripe-webhook-raw-body.registry', () => {
  it('reports true for a URL that was registered', () => {
    const url = '/api/v1/billing/webhook-registry-positive';
    registerStripeWebhookRawBodyRoute(url);

    expect(isStripeWebhookRawBodyRoute(url)).toBe(true);
  });

  it('reports false for a URL that was never registered', () => {
    // The whole point of the registry: anything not explicitly declared with
    // `config.captureRawBody = true` must NOT have its body buffered.
    expect(isStripeWebhookRawBodyRoute('/api/v1/billing/webhook-registry-never-registered')).toBe(
      false,
    );
  });

  it('listStripeWebhookRawBodyRoutes returns the registered URLs', () => {
    const url = '/api/v1/billing/webhook-registry-listed';
    registerStripeWebhookRawBodyRoute(url);

    expect(listStripeWebhookRawBodyRoutes()).toContain(url);
  });

  it('registration is idempotent — registering twice yields a single entry', () => {
    const url = '/api/v1/billing/webhook-registry-idempotent';
    registerStripeWebhookRawBodyRoute(url);
    registerStripeWebhookRawBodyRoute(url);

    const occurrences = listStripeWebhookRawBodyRoutes().filter((entry) => entry === url).length;
    expect(occurrences).toBe(1);
  });

  it('does NOT match a near-miss URL (trailing slash or different prefix)', () => {
    // Matching is exact-set membership, not prefix/normalizing. A near-miss must fail closed:
    // the raw body is not captured, so `constructEvent` rejects rather than verifying a
    // re-serialized (byte-shifted) payload against Stripe's HMAC.
    const url = '/api/v1/billing/webhook-registry-exact';
    registerStripeWebhookRawBodyRoute(url);

    expect(isStripeWebhookRawBodyRoute(`${url}/`)).toBe(false);
    expect(isStripeWebhookRawBodyRoute('/billing/webhook-registry-exact')).toBe(false);
    expect(isStripeWebhookRawBodyRoute(url.toUpperCase())).toBe(false);
  });
});
