/**
 * Tenancy domain seed module — composes the permission sub-domain's reference contribution
 * with the organization/role/membership bulk graph. Registered by the bulk orchestrator.
 */
import { permissionSeedContribution } from '@/domains/tenancy/sub-domains/permission/seed/index.js';
import { composeContributions, type DomainSeedModule } from '@/scripts/seed/seed-contract.js';
import { seedOrganizationsBulk } from './tenancy.bulk.seed.js';

const referenceContribution = composeContributions(permissionSeedContribution);

/** The tenancy domain's seed module: permission reference data + org/member/role bulk graph. */
export const tenancySeedModule: DomainSeedModule = {
  name: 'tenancy',
  dependsOn: ['user'],
  seedReference: referenceContribution.seedReference,
  seedBulk: seedOrganizationsBulk,
};
