/**
 * User-settings sub-domain seed contribution — one `auth.user_settings` row per registry user.
 * Composed up into the user domain's seed module after the user pool is populated.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedUserSettingsBulk } from './user-settings.bulk.seed.js';

/** Bulk-only contribution that seeds per-user settings singletons. */
export const userSettingsSeedContribution: SeedContribution = {
  seedBulk: seedUserSettingsBulk,
};
