/**
 * User domain seed module. The user domain has no reference data; its bulk seeder fills the
 * user pool that the tenancy seeder draws owners and members from.
 */
import type { DomainSeedModule } from '@/scripts/seed/seed-contract.js';
import { seedUsersBulk } from './user.bulk.seed.js';

/** The user domain's seed module (registered by the bulk orchestrator). */
export const userSeedModule: DomainSeedModule = {
  name: 'user',
  seedBulk: seedUsersBulk,
};
