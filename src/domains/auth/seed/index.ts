/**
 * Auth domain seed module — composes the per-user auth artifact contributions (login methods,
 * passkeys, sessions, MFA factors) into one bulk seeder. Auth is a bundled domain with no
 * reference data; every contribution reads `context.registry.users`, so the module depends on
 * the user domain's bulk seeder having populated the pool first.
 *
 * Registered by the bulk orchestrator (`src/scripts/seed/bulk.ts`).
 */
import { authMethodSeedContribution } from '@/domains/auth/sub-domains/auth-method/seed/index.js';
import { authMfaSeedContribution } from '@/domains/auth/sub-domains/auth-mfa/seed/index.js';
import { authSessionSeedContribution } from '@/domains/auth/sub-domains/auth-session/seed/index.js';
import { authWebauthnSeedContribution } from '@/domains/auth/sub-domains/auth-webauthn/seed/index.js';
import { composeContributions, type DomainSeedModule } from '@/scripts/seed/seed-contract.js';

const bulkContribution = composeContributions(
  authMethodSeedContribution,
  authWebauthnSeedContribution,
  authSessionSeedContribution,
  authMfaSeedContribution,
);

/** The auth domain's seed module: per-user auth artifacts, seeded after the user pool exists. */
export const authSeedModule: DomainSeedModule = {
  name: 'auth',
  dependsOn: ['user'],
  seedBulk: bulkContribution.seedBulk,
};
