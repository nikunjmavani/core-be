/**
 * Auth-session sub-domain seed contribution — a few sessions per registry user (with expired
 * edge cases). Composed up into the auth domain's seed module (which depends on the user pool).
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedAuthSessionsBulk } from './auth-session.bulk.seed.js';

/** Bulk-only contribution that seeds per-user browser/device sessions. */
export const authSessionSeedContribution: SeedContribution = {
  seedBulk: seedAuthSessionsBulk,
};
