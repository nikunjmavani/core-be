/**
 * Plan sub-domain seed contribution — seeds the global plan catalog (reference data).
 * Composed up into the billing domain's seed module.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedPlans } from './plan.reference.seed.js';

/** Reference-only contribution that upserts the default plan catalog. */
export const planSeedContribution: SeedContribution = {
  async seedReference(): Promise<void> {
    await seedPlans();
  },
};
