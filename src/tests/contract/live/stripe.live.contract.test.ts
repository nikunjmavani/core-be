import { afterAll, describe, expect, test } from 'vitest';
import { StripeCustomerApiResponseContractSchema } from '@/tests/contract/schemas/stripe.schemas.js';
import { PROJECT_SLUG } from '@/shared/constants/project-identity.constants.js';
import {
  createStripeCustomer,
  getStripeCustomer,
  getStripeClient,
  listRecentStripeEvents,
} from '@/infrastructure/payment/stripe.client.js';
import { hasStripeLiveCredentials, describeSkipReason } from './helpers/live-credentials.js';

/**
 * Live Stripe contract — the same assertions the offline tier makes against fixtures, but
 * against real Stripe test mode. This is the only thing that fails when Stripe changes a
 * response shape; the fixture tier cannot notice.
 *
 * Only ever runs against an `sk_test_` key (enforced by {@link hasStripeLiveCredentials}).
 * Every customer it creates is deleted in `afterAll`.
 */
const createdCustomerIds: string[] = [];

describe.skipIf(!hasStripeLiveCredentials())('Stripe LIVE contract (test mode)', () => {
  afterAll(async () => {
    // Test-mode objects are free, but leaving them behind makes the dashboard useless.
    const stripe = getStripeClient();
    for (const customerId of createdCustomerIds) {
      await stripe.customers.del(customerId).catch(() => undefined);
    }
  });

  test('createStripeCustomer returns a customer matching the response contract', async () => {
    const customer = await createStripeCustomer({
      email: `contract-live-${Date.now()}@example.com`,
      name: 'Live Contract Check',
      metadata: { source: `${PROJECT_SLUG}-live-contract` },
    });
    createdCustomerIds.push(customer.id);

    const parsed = StripeCustomerApiResponseContractSchema.safeParse(customer);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // The guard in live-credentials should make this impossible — assert it anyway.
    expect(customer.livemode).toBe(false);
    expect(customer.id.startsWith('cus_')).toBe(true);
  });

  test('getStripeCustomer round-trips the created customer', async () => {
    const created = await createStripeCustomer({
      email: `contract-live-roundtrip-${Date.now()}@example.com`,
      name: 'Live Contract Roundtrip',
    });
    createdCustomerIds.push(created.id);

    const fetched = await getStripeCustomer(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(StripeCustomerApiResponseContractSchema.safeParse(fetched).success).toBe(true);
  });

  test('listRecentStripeEvents returns an events page in the documented envelope', async () => {
    const events = await listRecentStripeEvents({
      createdGteSeconds: Math.floor(Date.now() / 1000) - 3600,
      limit: 3,
    });

    expect(Array.isArray(events)).toBe(true);
    // The account may legitimately have no recent events; shape-check whatever came back.
    for (const event of events) {
      expect(event.object).toBe('event');
      expect(typeof event.id).toBe('string');
      expect(typeof event.type).toBe('string');
    }
  });
});

describe.skipIf(hasStripeLiveCredentials())('Stripe LIVE contract — skipped', () => {
  test('reports why it did not run', () => {
    expect(describeSkipReason('stripe')).toContain('stripe');
  });
});
