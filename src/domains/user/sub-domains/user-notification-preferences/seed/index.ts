/**
 * User-notification-preferences sub-domain seed contribution — one global preference row per
 * registry user. Composed up into the user domain's seed module after the user pool is populated.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedUserNotificationPreferencesBulk } from './user-notification-preferences.bulk.seed.js';

/** Bulk-only contribution that seeds per-user notification preferences. */
export const userNotificationPreferencesSeedContribution: SeedContribution = {
  seedBulk: seedUserNotificationPreferencesBulk,
};
