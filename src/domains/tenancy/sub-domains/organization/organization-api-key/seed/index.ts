/**
 * Organization-api-key sub-domain seed contribution — `counts.apiKeysPerOrg` hashed keys per
 * registry organization (with revoked edge cases). Composed up into the tenancy domain's seed
 * module after organizations exist.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedOrganizationApiKeysBulk } from './organization-api-key.bulk.seed.js';

/** Bulk-only contribution that seeds per-organization API keys. */
export const organizationApiKeySeedContribution: SeedContribution = {
  seedBulk: seedOrganizationApiKeysBulk,
};
