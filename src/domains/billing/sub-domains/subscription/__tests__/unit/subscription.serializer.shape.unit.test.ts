import { describe, expect, it } from 'vitest';
import { SubscriptionSerializer } from '@/domains/billing/sub-domains/subscription/subscription.serializer.js';

describe('subscription.serializer shape (regression-guard)', () => {
  it('SubscriptionSerializer.one returns the same expected public-shaped fields untouched', () => {
    const subscription = {
      id: 'sub_01',
      status: 'active',
      plan_id: 'pln_01',
      billing_cycle: 'monthly',
      current_period_start: '2026-01-01T00:00:00.000Z',
      current_period_end: '2026-02-01T00:00:00.000Z',
      cancel_at_period_end: false,
    };
    const result = SubscriptionSerializer.one(subscription);
    expect(result).toBe(subscription);
    expect(Object.keys(result).sort()).toEqual(Object.keys(subscription).sort());
  });

  it('SubscriptionSerializer.one currently passes provider_subscription_id through (regression-guard for pass-through behavior)', () => {
    const subscription = {
      id: 'sub_02',
      status: 'active',
      provider: 'stripe',
      provider_subscription_id: 'stripe_sub_xyz',
    };
    const result = SubscriptionSerializer.one(subscription);
    expect(result).toBe(subscription);
    expect(result).toHaveProperty('provider_subscription_id', 'stripe_sub_xyz');
    expect(result).toHaveProperty('provider', 'stripe');
  });

  it('SubscriptionSerializer.many preserves order and identity for each subscription', () => {
    const subscriptionA = { id: 'sub_a', status: 'active' };
    const subscriptionB = { id: 'sub_b', status: 'past_due' };
    const subscriptionC = { id: 'sub_c', status: 'canceled' };
    const result = SubscriptionSerializer.many([subscriptionA, subscriptionB, subscriptionC]);
    expect(result.map((entry) => entry.id)).toEqual(['sub_a', 'sub_b', 'sub_c']);
    expect(result[0]).toBe(subscriptionA);
  });
});
