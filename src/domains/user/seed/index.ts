/**
 * User domain seed module. The user domain has no reference data; its bulk seeder first fills the
 * user pool that downstream domains (tenancy, auth) draw from, then composes the per-user
 * sub-domain extras (settings, notification preferences, data exports) on top of that pool.
 */
import { userDataExportSeedContribution } from '@/domains/user/sub-domains/user-data-export/seed/index.js';
import { userNotificationPreferencesSeedContribution } from '@/domains/user/sub-domains/user-notification-preferences/seed/index.js';
import { userSettingsSeedContribution } from '@/domains/user/sub-domains/user-settings/seed/index.js';
import {
  composeContributions,
  type DomainSeedModule,
  type SeedContribution,
} from '@/scripts/seed/seed-contract.js';
import { seedUsersBulk } from './user.bulk.seed.js';

/**
 * Pool contribution — seeds the user pool and populates `context.registry.users`. Must run before
 * the per-user sub-domain contributions, which read the registry.
 */
const userPoolContribution: SeedContribution = {
  seedBulk: seedUsersBulk,
};

const bulkContribution = composeContributions(
  userPoolContribution,
  userSettingsSeedContribution,
  userNotificationPreferencesSeedContribution,
  userDataExportSeedContribution,
);

/** The user domain's seed module (registered by the bulk orchestrator). */
export const userSeedModule: DomainSeedModule = {
  name: 'user',
  seedBulk: bulkContribution.seedBulk,
};
