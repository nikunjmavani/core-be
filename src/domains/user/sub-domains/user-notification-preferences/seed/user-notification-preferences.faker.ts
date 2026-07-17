/**
 * Faker generators for the user-notification-preferences bulk seeder. Callers pass the
 * orchestrator's seeded `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@/shared/constants/index.js';

/** Generated opt-in row for `auth.user_notification_preferences`. */
export interface BulkNotificationPreferenceProfile {
  /** Notification type identifier (e.g. `security.alert`). */
  notification_type: string;
  /** Delivery channel; constrained to the schema check (`EMAIL`/`SMS`/`PUSH`/`IN_APP`). */
  channel: string;
  /** Whether the user opted in for this `(type, channel)` pair. */
  is_enabled: boolean;
}

const CHANNELS = NOTIFICATION_CHANNELS;

/** Builds one fake notification-preference profile from the provided faker instance. */
export function generateBulkNotificationPreference(
  faker: Faker,
): BulkNotificationPreferenceProfile {
  return {
    notification_type: faker.helpers.arrayElement(NOTIFICATION_TYPES),
    channel: faker.helpers.arrayElement(CHANNELS),
    is_enabled: faker.datatype.boolean({ probability: 0.75 }),
  };
}
