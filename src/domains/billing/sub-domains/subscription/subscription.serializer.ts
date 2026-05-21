export const SubscriptionSerializer = {
  one<T>(subscription: T): T {
    return subscription;
  },
  many<T>(subscriptions: T[]): T[] {
    return subscriptions;
  },
};
