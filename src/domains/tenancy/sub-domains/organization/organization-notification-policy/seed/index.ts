/**
 * Organization-notification-policy sub-domain seed contribution — one default policy per registry
 * organization. Composed up into the tenancy domain's seed module after organizations exist.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedOrganizationNotificationPoliciesBulk } from './organization-notification-policy.bulk.seed.js';

/** Bulk-only contribution that seeds per-organization notification policies. */
export const organizationNotificationPolicySeedContribution: SeedContribution = {
  seedBulk: seedOrganizationNotificationPoliciesBulk,
};
