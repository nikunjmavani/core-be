/**
 * Notification sub-domain seed contribution — bulk in-app notifications per registered user.
 * Composed up into the notify domain's seed module.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedNotificationsBulk } from './notification.bulk.seed.js';

/** Bulk-only contribution that fills each user's notification inbox. */
export const notificationSeedContribution: SeedContribution = {
  seedBulk: seedNotificationsBulk,
};
