/**
 * User-data-export sub-domain seed contribution — mixed-status export rows for a subset of
 * registry users (plus a pending edge case). Composed up into the user domain's seed module
 * after the user pool is populated.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedUserDataExportsBulk } from './user-data-export.bulk.seed.js';

/** Bulk-only contribution that seeds per-user data-export requests. */
export const userDataExportSeedContribution: SeedContribution = {
  seedBulk: seedUserDataExportsBulk,
};
