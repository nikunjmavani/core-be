/**
 * Auth-method sub-domain seed contribution — one verified login credential per registry user.
 * Composed up into the auth domain's seed module (which depends on the user pool).
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedAuthMethodsBulk } from './auth-method.bulk.seed.js';

/** Bulk-only contribution that seeds per-user login auth methods. */
export const authMethodSeedContribution: SeedContribution = {
  seedBulk: seedAuthMethodsBulk,
};
