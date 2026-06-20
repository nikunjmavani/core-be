import { describe, expect, test } from 'vitest';

import {
  cancelStripeSubscription,
  createStripeCustomer,
  createStripeSubscription,
  listRecentStripeEvents,
  resumeStripeSubscription,
  updateStripeSubscription,
} from '@/infrastructure/payment/stripe.client.js';

import customerCreateRequestSubset from './fixtures/stripe/customer.create.request.fields.json' with {
  type: 'json',
};
import customerCreateFixtureResponse from './fixtures/stripe/customer.create.response.json' with {
  type: 'json',
};
import subscriptionCancelFixtureResponse from './fixtures/stripe/subscription.cancel.response.json' with {
  type: 'json',
};
import subscriptionCreateRequestSubset from './fixtures/stripe/subscription.create.request.fields.json' with {
  type: 'json',
};
import subscriptionCreateFixtureResponse from './fixtures/stripe/subscription.create.response.json' with {
  type: 'json',
};
import subscriptionRetrieveFixtureResponse from './fixtures/stripe/subscription.retrieve.response.json' with {
  type: 'json',
};
import subscriptionUpdateCancelFixtureResponse from './fixtures/stripe/subscription.update.cancel-at-period-end.response.json' with {
  type: 'json',
};
import subscriptionUpdateFixtureRequestSubset from './fixtures/stripe/subscription.update.request.fields.json' with {
  type: 'json',
};
import subscriptionUpdateFixtureResponse from './fixtures/stripe/subscription.update.response.json' with {
  type: 'json',
};
import subscriptionResumeFixtureResponse from './fixtures/stripe/subscription.update.resume.response.json' with {
  type: 'json',
};
import { assertStripeEncodedFormContainsExpectedFields } from './helpers/stripe-form.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';
import {
  StripeCustomerApiResponseContractSchema,
  StripeSubscriptionApiResponseContractSchema,
} from './schemas/stripe.schemas.js';

import nock from 'nock';

registerThirdPartyContractTestIsolationHooks();

const stripeOutboundApiHostname = 'https://api.stripe.com';

describe('Stripe outbound SDK contract (`stripe.client`)', () => {
  test('createStripeCustomer encodes predictable fields and maps the Stripe customer response', async () => {
    nock(stripeOutboundApiHostname)
      .post('/v1/customers', (encodedOutboundBodyUnknown) => {
        assertStripeEncodedFormContainsExpectedFields({
          stripeOutboundRequestBody: encodedOutboundBodyUnknown,
          expectedStripeFields: customerCreateRequestSubset as Record<string, string>,
        });
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, customerCreateFixtureResponse);

    const createdStripeCustomerOutbound = await createStripeCustomer({
      email: customerCreateRequestSubset.email,
      name: customerCreateRequestSubset.name,
      metadata: {
        user_tag: customerCreateRequestSubset['metadata[user_tag]'],
      },
    });

    StripeCustomerApiResponseContractSchema.parse(createdStripeCustomerOutbound);
    expect(createdStripeCustomerOutbound.id).toBe(customerCreateFixtureResponse.id);
    expect(createdStripeCustomerOutbound.email).toBe(customerCreateFixtureResponse.email);
  });

  test('createStripeCustomer forwards the idempotency-key header when provided', async () => {
    const outboundIdempotencyKeyForCustomerCreateFixture = `idem-contract-customer-create-${Date.now().toFixed(0)}`;

    // nock only matches (and replies 200) if the Idempotency-Key header is present with this value;
    // without the fix the header is absent, nock does not match, and the request fails.
    nock(stripeOutboundApiHostname)
      .post('/v1/customers')
      .matchHeader('authorization', /^Bearer /)
      .matchHeader('idempotency-key', outboundIdempotencyKeyForCustomerCreateFixture)
      .reply(200, customerCreateFixtureResponse);

    const createdStripeCustomerOutbound = await createStripeCustomer({
      email: customerCreateRequestSubset.email,
      name: customerCreateRequestSubset.name,
      idempotencyKey: outboundIdempotencyKeyForCustomerCreateFixture,
    });

    StripeCustomerApiResponseContractSchema.parse(createdStripeCustomerOutbound);
    expect(createdStripeCustomerOutbound.id).toBe(customerCreateFixtureResponse.id);
  });

  test('createStripeSubscription sends idempotency header and maps subscription payload', async () => {
    const outboundIdempotencyKeyForSubscriptionCreateFixture = `idem-contract-subscription-create-${Date.now().toFixed(0)}`;

    nock(stripeOutboundApiHostname)
      .post('/v1/subscriptions', (encodedOutboundBodyUnknown) => {
        assertStripeEncodedFormContainsExpectedFields({
          stripeOutboundRequestBody: encodedOutboundBodyUnknown,
          expectedStripeFields: subscriptionCreateRequestSubset as Record<string, string>,
        });
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .matchHeader('idempotency-key', outboundIdempotencyKeyForSubscriptionCreateFixture)
      .reply(200, subscriptionCreateFixtureResponse);

    const createdStripeSubscriptionOutbound = await createStripeSubscription({
      customerId: subscriptionCreateRequestSubset.customer,
      priceId: subscriptionCreateRequestSubset['items[0][price]'],
      idempotencyKey: outboundIdempotencyKeyForSubscriptionCreateFixture,
    });

    StripeSubscriptionApiResponseContractSchema.parse(createdStripeSubscriptionOutbound);
    expect(createdStripeSubscriptionOutbound.id).toBe(subscriptionCreateFixtureResponse.id);
    expect(createdStripeSubscriptionOutbound.status).toBe(subscriptionCreateFixtureResponse.status);
  });

  test('updateStripeSubscription issues retrieve followed by predictable price swap fields', async () => {
    const subscriptionFixtureIdentifierOutbound = subscriptionRetrieveFixtureResponse.id;
    const subscriptionResourceGetPathPrefixOutbound = `/v1/subscriptions/${subscriptionFixtureIdentifierOutbound}`;

    nock(stripeOutboundApiHostname)
      .get((requestPathOutbound) =>
        requestPathOutbound.startsWith(subscriptionResourceGetPathPrefixOutbound),
      )
      .matchHeader('authorization', /^Bearer /)
      .reply(200, subscriptionRetrieveFixtureResponse);

    nock(stripeOutboundApiHostname)
      .post(
        `/v1/subscriptions/${subscriptionFixtureIdentifierOutbound}`,
        (encodedOutboundBodyUnknown) => {
          assertStripeEncodedFormContainsExpectedFields({
            stripeOutboundRequestBody: encodedOutboundBodyUnknown,
            expectedStripeFields: subscriptionUpdateFixtureRequestSubset as Record<string, string>,
          });
          return true;
        },
      )
      .matchHeader('authorization', /^Bearer /)
      .reply(200, subscriptionUpdateFixtureResponse);

    const patchedStripeSubscriptionOutbound = await updateStripeSubscription(
      subscriptionFixtureIdentifierOutbound,
      {
        priceId: subscriptionUpdateFixtureRequestSubset['items[0][price]'],
        metadata: {
          next_sync: subscriptionUpdateFixtureRequestSubset['metadata[next_sync]'],
        },
      },
    );

    StripeSubscriptionApiResponseContractSchema.parse(patchedStripeSubscriptionOutbound);
    expect(patchedStripeSubscriptionOutbound.id).toBe(subscriptionRetrieveFixtureResponse.id);
  });

  test('cancelStripeSubscription with cancel-at-period-end issues POST cancellation flags', async () => {
    const subscriptionFixtureIdentifierOutbound = subscriptionUpdateCancelFixtureResponse.id;

    nock(stripeOutboundApiHostname)
      .post(
        `/v1/subscriptions/${subscriptionFixtureIdentifierOutbound}`,
        (encodedOutboundBodyUnknown) => {
          assertStripeEncodedFormContainsExpectedFields({
            stripeOutboundRequestBody: encodedOutboundBodyUnknown,
            expectedStripeFields: { cancel_at_period_end: 'true' },
          });
          return true;
        },
      )
      .matchHeader('authorization', /^Bearer /)
      .reply(200, subscriptionUpdateCancelFixtureResponse);

    const canceledStripeSubscriptionOutbound = await cancelStripeSubscription(
      subscriptionFixtureIdentifierOutbound,
      true,
    );

    StripeSubscriptionApiResponseContractSchema.parse(canceledStripeSubscriptionOutbound);
    expect(canceledStripeSubscriptionOutbound.cancel_at_period_end).toBe(true);
  });

  test('resumeStripeSubscription issues cancel-at-period-end false form body', async () => {
    const subscriptionFixtureIdentifierOutbound = subscriptionResumeFixtureResponse.id;

    nock(stripeOutboundApiHostname)
      .post(
        `/v1/subscriptions/${subscriptionFixtureIdentifierOutbound}`,
        (encodedOutboundBodyUnknown) => {
          assertStripeEncodedFormContainsExpectedFields({
            stripeOutboundRequestBody: encodedOutboundBodyUnknown,
            expectedStripeFields: { cancel_at_period_end: 'false' },
          });
          return true;
        },
      )
      .matchHeader('authorization', /^Bearer /)
      .reply(200, subscriptionResumeFixtureResponse);

    const resumedStripeSubscriptionOutbound = await resumeStripeSubscription(
      subscriptionFixtureIdentifierOutbound,
    );

    StripeSubscriptionApiResponseContractSchema.parse(resumedStripeSubscriptionOutbound);
    expect(resumedStripeSubscriptionOutbound.cancel_at_period_end).toBe(false);
  });

  test('cancelStripeSubscription with immediate termination issues DELETE verb', async () => {
    const subscriptionFixtureIdentifierOutbound = subscriptionCancelFixtureResponse.id;

    nock(stripeOutboundApiHostname)
      .delete(`/v1/subscriptions/${subscriptionFixtureIdentifierOutbound}`)
      .matchHeader('authorization', /^Bearer /)
      .reply(200, subscriptionCancelFixtureResponse);

    const immediateCanceledStripeSubscriptionOutbound = await cancelStripeSubscription(
      subscriptionFixtureIdentifierOutbound,
      false,
    );

    StripeSubscriptionApiResponseContractSchema.parse(immediateCanceledStripeSubscriptionOutbound);
    expect(immediateCanceledStripeSubscriptionOutbound.status).toBe('canceled');
  });

  test('listRecentStripeEvents sends created[gte]+limit and maps the events.list page data', async () => {
    const createdGteSeconds = 1_700_000_000;
    let capturedQuery: Record<string, string> | undefined;

    nock(stripeOutboundApiHostname)
      .get('/v1/events')
      .query((actualQuery) => {
        capturedQuery = actualQuery as Record<string, string>;
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, {
        object: 'list',
        has_more: false,
        data: [
          { id: 'evt_catchup_1', object: 'event', type: 'customer.subscription.updated' },
          { id: 'evt_catchup_2', object: 'event', type: 'customer.subscription.deleted' },
        ],
      });

    const events = await listRecentStripeEvents({ createdGteSeconds, limit: 100 });

    expect(events.map((event) => event.id)).toEqual(['evt_catchup_1', 'evt_catchup_2']);
    // The SDK serializes range filters as created[gte] and forwards the page limit.
    expect(capturedQuery?.['created[gte]']).toBe(String(createdGteSeconds));
    expect(capturedQuery?.limit).toBe('100');
  });
});
