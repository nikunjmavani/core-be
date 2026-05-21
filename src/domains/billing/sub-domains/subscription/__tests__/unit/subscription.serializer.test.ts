import { describe, expect, it } from 'vitest';
import { SubscriptionSerializer } from '@/domains/billing/sub-domains/subscription/subscription.serializer.js';

describe('subscription.serializer', () => {
  it('SubscriptionSerializer is pass-through', () => {
    const subscription = { id: 'sub-1' };
    expect(SubscriptionSerializer.one(subscription)).toBe(subscription);
    expect(SubscriptionSerializer.many([subscription])).toEqual([subscription]);
  });
});
