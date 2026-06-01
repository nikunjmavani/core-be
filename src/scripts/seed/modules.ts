/**
 * The registry of domain seed modules the bulk orchestrator runs. Kept separate from `bulk.ts`
 * (which auto-runs on execution) so tests can import the module set without triggering a seed.
 */
import { auditSeedModule } from '@/domains/audit/seed/index.js';
import { authSeedModule } from '@/domains/auth/seed/index.js';
import { billingSeedModule } from '@/domains/billing/seed/index.js';
import { notifySeedModule } from '@/domains/notify/seed/index.js';
import { tenancySeedModule } from '@/domains/tenancy/seed/index.js';
import { uploadSeedModule } from '@/domains/upload/seed/index.js';
import { userSeedModule } from '@/domains/user/seed/index.js';
import type { DomainSeedModule } from './seed-contract.js';

/** Every registered domain seed module (ordered topologically by `dependsOn` at run time). */
export const SEED_MODULES: DomainSeedModule[] = [
  userSeedModule,
  authSeedModule,
  tenancySeedModule,
  billingSeedModule,
  notifySeedModule,
  uploadSeedModule,
  auditSeedModule,
];
