import {
  createStripeSetupIntent,
  listStripeInvoices,
  listStripePaymentMethods,
  retrieveStripeCustomerDefaultPaymentMethodId,
  retrieveStripeSubscriptionPaymentClientSecret,
} from '@/infrastructure/payment/stripe.client.js';
import nock from 'nock';
import { describe, expect, test } from 'vitest';

import invoicesListFixture from './fixtures/stripe/invoices.list.response.json' with {
  type: 'json',
};
import paymentMethodsListFixture from './fixtures/stripe/payment-methods.list.response.json' with {
  type: 'json',
};
import customerDefaultPaymentMethodFixture from './fixtures/stripe/customer.retrieve.default-pm.response.json' with {
  type: 'json',
};
import setupIntentCreateFixture from './fixtures/stripe/setup-intent.create.response.json' with {
  type: 'json',
};
import subscriptionConfirmationSecretFixture from './fixtures/stripe/subscription.retrieve.confirmation-secret.response.json' with {
  type: 'json',
};
import { assertStripeEncodedFormContainsExpectedFields } from './helpers/stripe-form.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';
import {
  StripeInvoiceListResponseContractSchema,
  StripePaymentMethodListResponseContractSchema,
  StripeSetupIntentResponseContractSchema,
  StripeSubscriptionConfirmationSecretContractSchema,
} from './schemas/stripe.schemas.js';

registerThirdPartyContractTestIsolationHooks();

const stripeOutboundApiHostname = 'https://api.stripe.com';

/**
 * Contract for the Stripe billing-account READ + setup surface — the outbound operations
 * behind `GET /billing/invoices`, `GET /billing/payment-methods`, and the add-card /
 * incomplete-payment flows. The write/subscription surface was already pinned in
 * `stripe.contract.test.ts`; these five ops (invoices list, payment-methods list, customer
 * default-PM retrieve, setup-intent create, subscription confirmation-secret retrieve) made
 * real outbound calls with NO wire-contract guard — a Stripe SDK/API drift (a renamed field,
 * a moved `client_secret`, a changed query param) would slip past every mock-based integration
 * test. Each test pins the request path/params + the response fields the billing-account
 * serializer and controllers actually read.
 */
describe('Stripe billing-account read + setup contract (`stripe.client`)', () => {
  const contractCustomerId = 'cus_CONTRACTfixture01';

  test('listStripeInvoices requests /v1/invoices scoped by customer and maps the page', async () => {
    let capturedQuery: Record<string, string> | undefined;
    nock(stripeOutboundApiHostname)
      .get('/v1/invoices')
      .query((actualQuery) => {
        capturedQuery = actualQuery as Record<string, string>;
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, invoicesListFixture);

    const page = await listStripeInvoices(contractCustomerId, { limit: 10 });

    // Request shape: the customer filter is mandatory (never a global invoice list) and the
    // limit is forwarded so pagination stays bounded.
    expect(capturedQuery?.customer).toBe(contractCustomerId);
    expect(capturedQuery?.limit).toBe('10');

    // Response shape the serializer depends on.
    StripeInvoiceListResponseContractSchema.parse(invoicesListFixture);
    expect(page.has_more).toBe(false);
    expect(page.data).toHaveLength(2);
    expect(page.data[0]?.id).toBe('in_1CONTRACTfixture0001');
    expect(page.data[0]?.status).toBe('paid');
  });

  test('listStripeInvoices forwards starting_after for keyset pagination when provided', async () => {
    let capturedQuery: Record<string, string> | undefined;
    nock(stripeOutboundApiHostname)
      .get('/v1/invoices')
      .query((actualQuery) => {
        capturedQuery = actualQuery as Record<string, string>;
        return true;
      })
      .reply(200, invoicesListFixture);

    await listStripeInvoices(contractCustomerId, { limit: 5, startingAfter: 'in_cursor_prev' });

    expect(capturedQuery?.starting_after).toBe('in_cursor_prev');
    expect(capturedQuery?.limit).toBe('5');
  });

  test('listStripePaymentMethods requests /v1/payment_methods filtered to type=card', async () => {
    let capturedQuery: Record<string, string> | undefined;
    nock(stripeOutboundApiHostname)
      .get('/v1/payment_methods')
      .query((actualQuery) => {
        capturedQuery = actualQuery as Record<string, string>;
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, paymentMethodsListFixture);

    const paymentMethods = await listStripePaymentMethods(contractCustomerId);

    // type=card is a hard filter — the serializer only renders card brand/last4/exp.
    expect(capturedQuery?.customer).toBe(contractCustomerId);
    expect(capturedQuery?.type).toBe('card');

    StripePaymentMethodListResponseContractSchema.parse(paymentMethodsListFixture);
    expect(paymentMethods).toHaveLength(1);
    expect(paymentMethods[0]?.card?.last4).toBe('4242');
    expect(paymentMethods[0]?.card?.brand).toBe('visa');
  });

  test('retrieveStripeCustomerDefaultPaymentMethodId reads invoice_settings.default_payment_method', async () => {
    nock(stripeOutboundApiHostname)
      .get(`/v1/customers/${contractCustomerId}`)
      .matchHeader('authorization', /^Bearer /)
      .reply(200, customerDefaultPaymentMethodFixture);

    const defaultPaymentMethodId =
      await retrieveStripeCustomerDefaultPaymentMethodId(contractCustomerId);

    expect(defaultPaymentMethodId).toBe('pm_1CONTRACTfixtureDEFAULT');
  });

  test('retrieveStripeCustomerDefaultPaymentMethodId returns null when no default is set', async () => {
    nock(stripeOutboundApiHostname)
      .get(`/v1/customers/${contractCustomerId}`)
      .reply(200, {
        id: contractCustomerId,
        object: 'customer',
        invoice_settings: { default_payment_method: null },
      });

    await expect(
      retrieveStripeCustomerDefaultPaymentMethodId(contractCustomerId),
    ).resolves.toBeNull();
  });

  test('createStripeSetupIntent POSTs customer + card type and returns the client_secret', async () => {
    nock(stripeOutboundApiHostname)
      .post('/v1/setup_intents', (encodedBody) => {
        assertStripeEncodedFormContainsExpectedFields({
          stripeOutboundRequestBody: encodedBody,
          expectedStripeFields: {
            customer: contractCustomerId,
            'payment_method_types[0]': 'card',
          },
        });
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, setupIntentCreateFixture);

    const clientSecret = await createStripeSetupIntent(contractCustomerId);

    StripeSetupIntentResponseContractSchema.parse(setupIntentCreateFixture);
    expect(clientSecret).toBe(setupIntentCreateFixture.client_secret);
  });

  test('retrieveStripeSubscriptionPaymentClientSecret expands latest_invoice.confirmation_secret', async () => {
    const subscriptionId = 'sub_CONTRACTfixture01';
    let capturedQuery: Record<string, unknown> | undefined;
    nock(stripeOutboundApiHostname)
      .get(`/v1/subscriptions/${subscriptionId}`)
      .query((actualQuery) => {
        capturedQuery = actualQuery as Record<string, unknown>;
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, subscriptionConfirmationSecretFixture);

    const clientSecret = await retrieveStripeSubscriptionPaymentClientSecret(subscriptionId);

    // The expand param is the whole point: without it Stripe omits confirmation_secret and
    // the client would read null. Stripe encodes array params as expand[0]=...
    const expandValues = Object.entries(capturedQuery ?? {})
      .filter(([key]) => key.startsWith('expand'))
      .map(([, value]) => String(value));
    expect(expandValues).toContain('latest_invoice.confirmation_secret');

    StripeSubscriptionConfirmationSecretContractSchema.parse(subscriptionConfirmationSecretFixture);
    expect(clientSecret).toBe('pi_CONTRACTfixture01_secret_CONTRACTpaymentsecret');
  });

  test('retrieveStripeSubscriptionPaymentClientSecret returns null when the invoice carries no secret', async () => {
    const subscriptionId = 'sub_no_secret';
    nock(stripeOutboundApiHostname)
      .get(`/v1/subscriptions/${subscriptionId}`)
      .query(() => true)
      .reply(200, {
        id: subscriptionId,
        object: 'subscription',
        latest_invoice: { id: 'in_no_secret', object: 'invoice' },
      });

    await expect(retrieveStripeSubscriptionPaymentClientSecret(subscriptionId)).resolves.toBeNull();
  });
});
