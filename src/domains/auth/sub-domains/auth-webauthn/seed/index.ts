/**
 * Auth-webauthn sub-domain seed contribution — one passkey for a subset of registry users.
 * Composed up into the auth domain's seed module (which depends on the user pool).
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedAuthWebauthnBulk } from './auth-webauthn.bulk.seed.js';

/** Bulk-only contribution that seeds per-user WebAuthn credentials. */
export const authWebauthnSeedContribution: SeedContribution = {
  seedBulk: seedAuthWebauthnBulk,
};
