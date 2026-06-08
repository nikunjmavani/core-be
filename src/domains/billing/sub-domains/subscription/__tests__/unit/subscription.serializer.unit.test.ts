import { describe, expect, it } from 'vitest';
import { SubscriptionSerializer } from '@/domains/billing/sub-domains/subscription/subscription.serializer.js';

describe('subscription.serializer', () => {
  it('SubscriptionSerializer maps public_id → id, surfaces plan_public_id as plan_id, drops bigserials/provider ids (sec-T #17 + sec-re-07)', () => {
    const input = {
      id: 17,
      public_id: 'sub_publicpublicpublic',
      organization_id: 7,
      plan_id: 3, // bigserial — must NOT leak
      plan_public_id: 'pln_publicpublicpublic', // sec-re-07: surfaced as `plan_id` in the output
      provider: 'stripe',
      provider_subscription_id: 'sub_xxx',
      provider_customer_id: 'cus_yyy',
      billing_cycle: 'monthly',
      status: 'ACTIVE',
      current_period_start: '2026-06-01T00:00:00.000Z',
      current_period_end: '2026-07-01T00:00:00.000Z',
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      last_stripe_event_created_at: '2026-06-05T00:00:00.000Z',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-05T00:00:00.000Z',
      created_by_user_id: 9,
      updated_by_user_id: null,
    };

    const out = SubscriptionSerializer.one(input as never);

    expect(out).toEqual({
      id: 'sub_publicpublicpublic',
      status: 'ACTIVE',
      billing_cycle: 'monthly',
      current_period_start: '2026-06-01T00:00:00.000Z',
      current_period_end: '2026-07-01T00:00:00.000Z',
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      provider: 'stripe',
      plan_id: 'pln_publicpublicpublic',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-05T00:00:00.000Z',
    });
    // Belt-and-braces: confirm every leak-class field is absent. `plan_id` IS
    // present but holds the joined public id, NOT the bigserial.
    expect(out).not.toHaveProperty('organization_id');
    expect(out).not.toHaveProperty('plan_public_id');
    expect((out as { plan_id: unknown }).plan_id).not.toBe(3);
    expect(out).not.toHaveProperty('provider_subscription_id');
    expect(out).not.toHaveProperty('provider_customer_id');
    expect(out).not.toHaveProperty('last_stripe_event_created_at');
    expect(out).not.toHaveProperty('created_by_user_id');
    expect(out).not.toHaveProperty('updated_by_user_id');
    expect(SubscriptionSerializer.many([input as never])).toEqual([out]);
  });
});
