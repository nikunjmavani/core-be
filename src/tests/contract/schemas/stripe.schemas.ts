import { z } from 'zod';

/** Zod enum of every Stripe subscription status string our webhook handler must accept. */
export const StripeSubscriptionStatusSchemaContract = z.enum([
  'active',
  'canceled',
  'past_due',
  'trialing',
  'unpaid',
  'paused',
  'incomplete',
  'incomplete_expired',
]);

/** Subset of the form fields our billing service POSTs when creating a Stripe customer. */
export const StripeCustomerCreateFormExpectedSubsetSchemaContract = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

/** Zod contract for the Stripe customer object returned from `POST /v1/customers`. */
export const StripeCustomerApiResponseContractSchema = z.object({
  object: z.literal('customer'),
  id: z.string(),
  email: z.string(),
  livemode: z.boolean(),
});

/** Zod contract for Stripe's subscription-item list (we only require at least one item with an id). */
export const StripeSubscriptionItemListContractSchema = z.object({
  object: z.literal('list'),
  data: z
    .array(
      z.object({
        id: z.string(),
        object: z.literal('subscription_item'),
      }),
    )
    .min(1),
});

/** Zod contract for the Stripe subscription object our subscription service expects to read. */
export const StripeSubscriptionApiResponseContractSchema = z.object({
  object: z.literal('subscription'),
  id: z.string(),
  customer: z.string(),
  status: StripeSubscriptionStatusSchemaContract,
  cancel_at_period_end: z.boolean(),
  canceled_at: z.number().nullable().optional(),
  current_period_end: z.number().optional(),
  current_period_start: z.number().optional(),
  items: StripeSubscriptionItemListContractSchema.optional(),
});

/**
 * Zod contract for the inner `data.object` of a subscription webhook event;
 * uses `passthrough()` because Stripe routinely adds new fields without
 * bumping the API version and our handler must remain forward-compatible.
 */
export const StripeSubscriptionWebhookInnerContractSchema = z
  .object({
    object: z.literal('subscription'),
    id: z.string(),
    status: z.string(),
    cancel_at_period_end: z.boolean(),
    canceled_at: z.number().nullable().optional(),
  })
  .passthrough();

/** Zod contract for the full Stripe event envelope on `customer.subscription.*` webhooks. */
export const StripeEventEnvelopeSubscriptionWebhookContractSchema = z
  .object({
    id: z.string(),
    object: z.literal('event'),
    type: z.enum([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]),
    api_version: z.string().nullable().optional(),
    data: z.object({
      object: StripeSubscriptionWebhookInnerContractSchema,
    }),
  })
  .passthrough();

/**
 * Zod contract for Stripe's `GET /v1/invoices` list page — the fields the billing-account
 * serializer reads (`BillingAccountSerializer.invoice`). `.loose()` so a new upstream field
 * never fails the parse, but the shape we depend on is pinned.
 */
export const StripeInvoiceListResponseContractSchema = z.object({
  object: z.literal('list'),
  has_more: z.boolean(),
  data: z.array(
    z
      .object({
        id: z.string().min(1),
        object: z.literal('invoice'),
        status: z.string().nullable(),
        amount_due: z.number().int(),
        amount_paid: z.number().int(),
        currency: z.string().min(1),
        created: z.number().int(),
      })
      .loose(),
  ),
});

/**
 * Zod contract for `GET /v1/payment_methods?type=card` — the card fields the serializer
 * surfaces (`brand`, `last4`, `exp_month`, `exp_year`).
 */
export const StripePaymentMethodListResponseContractSchema = z.object({
  object: z.literal('list'),
  data: z.array(
    z
      .object({
        id: z.string().min(1),
        object: z.literal('payment_method'),
        type: z.string().min(1),
        card: z
          .object({
            brand: z.string().min(1),
            last4: z.string().length(4),
            exp_month: z.number().int(),
            exp_year: z.number().int(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  ),
});

/** Zod contract for `POST /v1/setup_intents` — only `client_secret` is consumed. */
export const StripeSetupIntentResponseContractSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal('setup_intent'),
    client_secret: z.string().min(1),
  })
  .loose();

/**
 * Zod contract for `GET /v1/subscriptions/{id}` expanded with
 * `latest_invoice.confirmation_secret` — the path the client walks to read the incomplete
 * subscription's payment client secret (Stripe API 2026-05-27.dahlia moved it here from
 * `Invoice.payment_intent`).
 */
export const StripeSubscriptionConfirmationSecretContractSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal('subscription'),
    latest_invoice: z
      .object({
        confirmation_secret: z
          .object({
            client_secret: z.string().min(1),
            type: z.string().min(1),
          })
          .loose()
          .optional(),
      })
      .loose()
      .nullable(),
  })
  .loose();
