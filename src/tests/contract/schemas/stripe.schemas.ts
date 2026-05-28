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
