/**
 * Audit domain seed module. The audit domain has no reference data; its bulk seeder fills the
 * append-only `audit.logs` ledger with time-distributed activity across the last `auditMonths`
 * months for every organization in the registry (creating monthly partitions when the table is
 * partitioned). Registered by the bulk orchestrator.
 */
import type { DomainSeedModule } from '@/scripts/seed/seed-contract.js';
import { seedAuditLogsBulk } from './audit.bulk.seed.js';

/** The audit domain's seed module (registered by the bulk orchestrator). */
export const auditSeedModule: DomainSeedModule = {
  name: 'audit',
  dependsOn: ['tenancy', 'user'],
  seedBulk: seedAuditLogsBulk,
};
