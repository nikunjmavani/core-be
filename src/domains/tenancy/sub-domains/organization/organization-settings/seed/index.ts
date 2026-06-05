/**
 * Organization-settings sub-domain seed contribution — one `tenancy.organization_settings` row
 * per registry organization. Composed up into the tenancy domain's seed module after
 * organizations exist.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedOrganizationSettingsBulk } from './organization-settings.bulk.seed.js';

/** Bulk-only contribution that seeds per-organization settings singletons. */
export const organizationSettingsSeedContribution: SeedContribution = {
  seedBulk: seedOrganizationSettingsBulk,
};
