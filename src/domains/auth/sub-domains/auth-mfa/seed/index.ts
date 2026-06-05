/**
 * Auth-mfa sub-domain seed contribution — a verified TOTP factor plus recovery codes for a
 * subset of registry users. Composed up into the auth domain's seed module (which depends on the
 * user pool).
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedAuthMfaBulk } from './auth-mfa.bulk.seed.js';

/** Bulk-only contribution that seeds per-user MFA factors and recovery codes. */
export const authMfaSeedContribution: SeedContribution = {
  seedBulk: seedAuthMfaBulk,
};
