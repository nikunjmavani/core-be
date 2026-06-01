/**
 * Permission sub-domain seed contribution — seeds the system permission catalog (reference
 * data). Composed up into the tenancy domain's seed module.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedPermissions } from './permission.reference.seed.js';

/** Reference-only contribution that upserts the system permission catalog. */
export const permissionSeedContribution: SeedContribution = {
  async seedReference(): Promise<void> {
    await seedPermissions();
  },
};
