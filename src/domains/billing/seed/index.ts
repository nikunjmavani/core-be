/**
 * Billing domain seed module — composes the plan sub-domain's reference contribution (the global
 * plan catalog) with the subscription bulk graph. Registered by the bulk orchestrator.
 */
import { planSeedContribution } from '@/domains/billing/sub-domains/plan/seed/index.js';
import { seedSubscriptionsBulk } from '@/domains/billing/sub-domains/subscription/seed/subscription.bulk.seed.js';
import { composeContributions, type DomainSeedModule } from '@/scripts/seed/seed-contract.js';

const referenceContribution = composeContributions(planSeedContribution);

/** The billing domain's seed module: plan reference data + per-organization subscription bulk graph. */
export const billingSeedModule: DomainSeedModule = {
  name: 'billing',
  dependsOn: ['tenancy'],
  seedReference: referenceContribution.seedReference,
  seedBulk: seedSubscriptionsBulk,
};
