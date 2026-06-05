/**
 * Faker generators for the notification bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** The in-app notification types the bulk seeder spreads rows across (matches the demo fixtures). */
export const BULK_NOTIFICATION_TYPES = [
  'system.welcome',
  'system.maintenance',
  'billing.usage_threshold',
  'billing.payment_succeeded',
  'membership.invite_accepted',
  'webhook.delivery_failed',
] as const;

/** A generated in-app notification's content fields (ids and read-state are assigned by the bulk seeder). */
export interface BulkNotificationContent {
  /** Notification category, e.g. `billing.usage_threshold`. */
  type: string;
  /** Short headline. */
  title: string;
  /** Body text. */
  message: string;
}

/** Builds one fake notification's content fields from the provided faker instance. */
export function generateBulkNotification(faker: Faker): BulkNotificationContent {
  const type = faker.helpers.arrayElement(BULK_NOTIFICATION_TYPES);
  return {
    type,
    title: faker.lorem.sentence({ min: 3, max: 6 }),
    message: faker.lorem.sentences({ min: 1, max: 3 }),
  };
}
