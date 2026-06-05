/**
 * Upload domain seed module. The upload domain has no reference data; its bulk seeder fills a
 * per-organization pool of uploads (mixed states + scopes) attached to organizations and users
 * created by the tenancy and user seeders. Registered by the bulk orchestrator.
 */
import type { DomainSeedModule } from '@/scripts/seed/seed-contract.js';
import { seedUploadsBulk } from './upload.bulk.seed.js';

/** The upload domain's seed module (registered by the bulk orchestrator). */
export const uploadSeedModule: DomainSeedModule = {
  name: 'upload',
  dependsOn: ['tenancy', 'user'],
  seedBulk: seedUploadsBulk,
};
