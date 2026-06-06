import { describe, expect, it } from 'vitest';
import { SubscriptionSerializer } from '@/domains/billing/sub-domains/subscription/subscription.serializer.js';

describe('subscription.serializer', () => {
  it('SubscriptionSerializer maps public_id → id and drops bigserials/provider ids (sec-T #17)', () => {
    const input = {
      id: 17,
      public_id: 'sub_publicpublicpublic',
      organization_id: 7,
      plan_id: 3,
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
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-05T00:00:00.000Z',
    });
    // Belt-and-braces: confirm every leak-class field is absent.
    expect(out).not.toHaveProperty('organization_id');
    expect(out).not.toHaveProperty('plan_id');
    expect(out).not.toHaveProperty('provider_subscription_id');
    expect(out).not.toHaveProperty('provider_customer_id');
    expect(out).not.toHaveProperty('last_stripe_event_created_at');
    expect(out).not.toHaveProperty('created_by_user_id');
    expect(out).not.toHaveProperty('updated_by_user_id');
    expect(SubscriptionSerializer.many([input as never])).toEqual([out]);
  });
});
