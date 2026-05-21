import { z } from 'zod';

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

export const StripeCustomerCreateFormExpectedSubsetSchemaContract = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export const StripeCustomerApiResponseContractSchema = z.object({
  object: z.literal('customer'),
  id: z.string(),
  email: z.string(),
  livemode: z.boolean(),
});

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

export const StripeSubscriptionWebhookInnerContractSchema = z
  .object({
    object: z.literal('subscription'),
    id: z.string(),
    status: z.string(),
    cancel_at_period_end: z.boolean(),
    canceled_at: z.number().nullable().optional(),
  })
  .passthrough();

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
