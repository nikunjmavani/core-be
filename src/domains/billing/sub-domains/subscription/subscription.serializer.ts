/**
 * Identity serializer for subscription responses — kept for symmetry with other
 * domains so routes can call `SubscriptionSerializer.one/many` uniformly.
 */
export const SubscriptionSerializer = {
  one<T>(subscription: T): T {
    return subscription;
  },
  many<T>(subscriptions: T[]): T[] {
    return subscriptions;
  },
};
