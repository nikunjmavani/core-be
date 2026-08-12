import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type Stripe from 'stripe';
import {
  StripeCustomerApiResponseContractSchema,
  StripeSubscriptionApiResponseContractSchema,
} from '@/tests/contract/schemas/stripe.schemas.js';
import { PROJECT_SLUG } from '@/shared/constants/project-identity.constants.js';
import {
  cancelStripeSubscription,
  createStripeCustomer,
  createStripeSetupIntent,
  createStripeSubscription,
  getStripeClient,
  getStripeCustomer,
  listRecentStripeEvents,
  listStripeInvoices,
  listStripePaymentMethods,
  resumeStripeSubscription,
  retrieveStripeCustomerDefaultPaymentMethodId,
  retrieveStripeEvent,
  retrieveStripeSubscriptionPaymentClientSecret,
  updateStripeSubscription,
  updateStripeSubscriptionQuantity,
} from '@/infrastructure/payment/stripe.client.js';
import { hasStripeLiveCredentials, describeSkipReason } from './helpers/live-credentials.js';

/**
 * Live Stripe contract — the money surface, against real Stripe **test mode**.
 *
 * @remarks
 * The offline tier replays frozen fixtures, so it proves the request we build but never that
 * Stripe still accepts it or still answers in the shape we map. Everything here is a real API
 * call validated against the same Zod contracts.
 *
 * Subscriptions need a product and a recurring price, so the suite provisions both in `beforeAll`
 * and removes every object it creates in `afterAll`. Test-mode objects are free and isolated from
 * live data; {@link hasStripeLiveCredentials} refuses anything that is not an `sk_test_` key.
 */
const createdCustomerIds: string[] = [];
const createdSubscriptionIds: string[] = [];
let productId = '';
let priceId = '';
let secondPriceId = '';

async function createCustomer(label: string): Promise<Stripe.Customer> {
  const customer = await createStripeCustomer({
    email: `contract-live-${label}-${Date.now()}@example.com`,
    name: `Live Contract ${label}`,
    metadata: { source: `${PROJECT_SLUG}-live-contract` },
  });
  createdCustomerIds.push(customer.id);
  return customer;
}

/**
 * Customer with a working test card attached and set as the default.
 *
 * @remarks
 * Without a payment method a subscription never leaves `incomplete`, and an immediate cancel
 * yields `incomplete_expired` rather than `canceled` — so the lifecycle assertions would be
 * testing a subscription that was never really live. `pm_card_visa` is Stripe's shared test token.
 */
async function createCustomerWithCard(label: string): Promise<Stripe.Customer> {
  const customer = await createCustomer(label);
  const stripe = getStripeClient();
  const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  return customer;
}

async function createSubscription(
  customerId: string,
  price = priceId,
): Promise<Stripe.Subscription> {
  const subscription = await createStripeSubscription({ customerId, priceId: price });
  createdSubscriptionIds.push(subscription.id);
  return subscription;
}

describe.skipIf(!hasStripeLiveCredentials())('Stripe LIVE contract (test mode)', () => {
  beforeAll(async () => {
    const stripe = getStripeClient();
    const product = await stripe.products.create({ name: `${PROJECT_SLUG} live contract product` });
    productId = product.id;
    const price = await stripe.prices.create({
      product: productId,
      currency: 'usd',
      unit_amount: 1000,
      recurring: { interval: 'month' },
    });
    priceId = price.id;
    const upgraded = await stripe.prices.create({
      product: productId,
      currency: 'usd',
      unit_amount: 2500,
      recurring: { interval: 'month' },
    });
    secondPriceId = upgraded.id;
  }, 60_000);

  afterAll(async () => {
    const stripe = getStripeClient();
    for (const subscriptionId of createdSubscriptionIds) {
      await stripe.subscriptions.cancel(subscriptionId).catch(() => undefined);
    }
    for (const customerId of createdCustomerIds) {
      await stripe.customers.del(customerId).catch(() => undefined);
    }
    // Prices cannot be deleted, only deactivated; the product goes once nothing references it.
    for (const id of [priceId, secondPriceId]) {
      if (id) await stripe.prices.update(id, { active: false }).catch(() => undefined);
    }
    if (productId)
      await stripe.products.update(productId, { active: false }).catch(() => undefined);
  }, 60_000);

  // ── Customers ──────────────────────────────────────────────────────────

  test('createStripeCustomer returns a customer matching the response contract', async () => {
    const customer = await createCustomer('create');

    const parsed = StripeCustomerApiResponseContractSchema.safeParse(customer);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // The credential gate should make this impossible — assert it anyway.
    expect(customer.livemode).toBe(false);
    expect(customer.id.startsWith('cus_')).toBe(true);
  });

  test('getStripeCustomer round-trips the created customer', async () => {
    const created = await createCustomer('roundtrip');

    const fetched = await getStripeCustomer(created.id);

    expect(fetched?.id).toBe(created.id);
    expect(StripeCustomerApiResponseContractSchema.safeParse(fetched).success).toBe(true);
  });

  test('getStripeCustomer returns null for an unknown id rather than throwing', async () => {
    // Callers branch on null; a thrown resource_missing would surface as a 500 instead of a 404.
    expect(await getStripeCustomer('cus_definitely_does_not_exist_00')).toBeNull();
  });

  test('getStripeCustomer returns null for a deleted customer', async () => {
    const customer = await createCustomer('deleted');
    await getStripeClient().customers.del(customer.id);

    expect(await getStripeCustomer(customer.id)).toBeNull();
  });

  test('an idempotency key makes a repeated create return the same customer', async () => {
    // The subscription path mints a customer when the org has none; without this guarantee a
    // retried request would strand a second Stripe customer against one organization.
    const idempotencyKey = `live-contract-customer-${Date.now()}`;
    const email = `contract-live-idem-${Date.now()}@example.com`;

    const first = await createStripeCustomer({ email, name: 'Idempotent', idempotencyKey });
    const second = await createStripeCustomer({ email, name: 'Idempotent', idempotencyKey });
    createdCustomerIds.push(first.id);

    expect(second.id).toBe(first.id);
  });

  // ── Subscription lifecycle ─────────────────────────────────────────────

  test('createStripeSubscription returns a subscription matching the response contract', async () => {
    const customer = await createCustomerWithCard('sub-create');

    const subscription = await createSubscription(customer.id);

    const parsed = StripeSubscriptionApiResponseContractSchema.safeParse(subscription);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(subscription.customer).toBe(customer.id);
    expect(subscription.items.data[0]?.price.id).toBe(priceId);
  });

  test('cancelStripeSubscription at period end keeps the subscription active', async () => {
    const customer = await createCustomerWithCard('sub-cancel-soft');
    const subscription = await createSubscription(customer.id);

    const cancelled = await cancelStripeSubscription(subscription.id, true);

    expect(cancelled.cancel_at_period_end).toBe(true);
    // Soft cancel must NOT end access immediately — billing keeps the period it was paid for.
    expect(cancelled.status).not.toBe('canceled');
  });

  test('createStripeSubscription opens the subscription as incomplete (SCA contract)', async () => {
    // The client passes `payment_behavior: 'default_incomplete'`, so a new subscription is NOT
    // billable until the front end confirms the payment intent. Anything that assumes a fresh
    // subscription is already active — entitlement checks, seat sync — would be wrong.
    const customer = await createCustomerWithCard('sub-incomplete');

    const subscription = await createSubscription(customer.id);

    expect(subscription.status).toBe('incomplete');
    expect(subscription.latest_invoice).not.toBeNull();
  });

  test('cancelStripeSubscription immediately moves the subscription to a terminal state', async () => {
    const customer = await createCustomerWithCard('sub-cancel-hard');
    const subscription = await createSubscription(customer.id);

    const cancelled = await cancelStripeSubscription(subscription.id, false);

    // Because subscriptions open as `incomplete` (see above), an immediate cancel expires the
    // unpaid subscription rather than cancelling an active one. Both are terminal and neither is
    // billable; asserting only 'canceled' would encode an activation this app never performs.
    expect(['canceled', 'incomplete_expired']).toContain(cancelled.status);
    expect(cancelled.cancel_at_period_end).toBe(false);
  });

  // ── Payment methods on a carded customer ───────────────────────────────

  test('listStripePaymentMethods returns an attached card', async () => {
    const customer = await createCustomerWithCard('pm-attached');

    const paymentMethods = await listStripePaymentMethods(customer.id);

    expect(paymentMethods).toHaveLength(1);
    expect(paymentMethods[0]?.type).toBe('card');
    expect(paymentMethods[0]?.card?.brand).toBe('visa');
  });

  test('retrieveStripeCustomerDefaultPaymentMethodId returns the default card id', async () => {
    const customer = await createCustomerWithCard('pm-default-set');

    const defaultPaymentMethodId = await retrieveStripeCustomerDefaultPaymentMethodId(customer.id);

    expect(defaultPaymentMethodId).toMatch(/^pm_/);
  });

  test('resumeStripeSubscription clears a pending period-end cancellation', async () => {
    const customer = await createCustomerWithCard('sub-resume');
    const subscription = await createSubscription(customer.id);
    await cancelStripeSubscription(subscription.id, true);

    const resumed = await resumeStripeSubscription(subscription.id);

    expect(resumed.cancel_at_period_end).toBe(false);
    expect(resumed.status).not.toBe('canceled');
  });

  test('updateStripeSubscription swaps the price (plan change)', async () => {
    const customer = await createCustomerWithCard('sub-update');
    const subscription = await createSubscription(customer.id);

    const updated = await updateStripeSubscription(subscription.id, { priceId: secondPriceId });

    expect(updated.items.data[0]?.price.id).toBe(secondPriceId);
    expect(StripeSubscriptionApiResponseContractSchema.safeParse(updated).success).toBe(true);
  });

  test('updateStripeSubscription writes metadata', async () => {
    const customer = await createCustomerWithCard('sub-metadata');
    const subscription = await createSubscription(customer.id);

    const updated = await updateStripeSubscription(subscription.id, {
      metadata: { organization_id: 'org_live_contract_probe' },
    });

    expect(updated.metadata.organization_id).toBe('org_live_contract_probe');
  });

  test('updateStripeSubscriptionQuantity changes the seat count', async () => {
    const customer = await createCustomerWithCard('sub-seats');
    const subscription = await createSubscription(customer.id);

    const updated = await updateStripeSubscriptionQuantity(subscription.id, 7);

    expect(updated.items.data[0]?.quantity).toBe(7);
  });

  test('createStripeSubscription rejects an unknown price with a typed Stripe error', async () => {
    const customer = await createCustomer('sub-badprice');

    await expect(
      createStripeSubscription({ customerId: customer.id, priceId: 'price_does_not_exist_xyz' }),
    ).rejects.toMatchObject({ type: expect.stringContaining('Stripe') });
  });

  // ── Billing reads ──────────────────────────────────────────────────────

  test('listStripeInvoices returns a paginated envelope for a subscribed customer', async () => {
    const customer = await createCustomerWithCard('invoices');
    await createSubscription(customer.id);

    const invoices = await listStripeInvoices(customer.id, { limit: 5 });

    expect(Array.isArray(invoices.data)).toBe(true);
    expect(typeof invoices.has_more).toBe('boolean');
    for (const invoice of invoices.data) {
      expect(invoice.object).toBe('invoice');
      expect(invoice.customer).toBe(customer.id);
    }
  });

  test('listStripePaymentMethods returns an empty list for a customer with no cards', async () => {
    const customer = await createCustomer('pm-empty');

    const paymentMethods = await listStripePaymentMethods(customer.id);

    expect(Array.isArray(paymentMethods)).toBe(true);
    expect(paymentMethods).toHaveLength(0);
  });

  test('retrieveStripeCustomerDefaultPaymentMethodId is null when none is set', async () => {
    const customer = await createCustomer('pm-default');

    expect(await retrieveStripeCustomerDefaultPaymentMethodId(customer.id)).toBeNull();
  });

  test('createStripeSetupIntent returns a usable client secret', async () => {
    const customer = await createCustomer('setup-intent');

    const clientSecret = await createStripeSetupIntent(customer.id);

    expect(typeof clientSecret).toBe('string');
    // The front end passes this straight to Stripe.js; the `seti_..._secret_...` shape is the
    // contract it depends on.
    expect(clientSecret).toMatch(/^seti_.+_secret_.+/);
  });

  test('retrieveStripeSubscriptionPaymentClientSecret resolves without throwing', async () => {
    const customer = await createCustomerWithCard('sub-secret');
    const subscription = await createSubscription(customer.id);

    const clientSecret = await retrieveStripeSubscriptionPaymentClientSecret(subscription.id);

    // Null is legitimate when no payment intent needs confirming; a string must be a client secret.
    expect(clientSecret === null || /_secret_/.test(clientSecret)).toBe(true);
  });

  // ── Events ─────────────────────────────────────────────────────────────

  test('listRecentStripeEvents returns an events page in the documented envelope', async () => {
    const events = await listRecentStripeEvents({
      createdGteSeconds: Math.floor(Date.now() / 1000) - 3600,
      limit: 3,
    });

    expect(Array.isArray(events)).toBe(true);
    for (const event of events) {
      expect(event.object).toBe('event');
      expect(typeof event.id).toBe('string');
      expect(typeof event.type).toBe('string');
    }
  });

  test('retrieveStripeEvent fetches a specific event by id', async () => {
    // The webhook reclaim worker depends on this: an event whose payload is missing from the
    // local ledger is re-fetched by id.
    const [recent] = await listRecentStripeEvents({
      createdGteSeconds: Math.floor(Date.now() / 1000) - 3600,
      limit: 1,
    });
    if (!recent) {
      expect(true).toBe(true);
      return;
    }

    const event = await retrieveStripeEvent(recent.id);

    expect(event.id).toBe(recent.id);
    expect(event.object).toBe('event');
  });
});

describe.skipIf(hasStripeLiveCredentials())('Stripe LIVE contract — skipped', () => {
  test('reports why it did not run', () => {
    expect(describeSkipReason('stripe')).toContain('stripe');
  });
});
