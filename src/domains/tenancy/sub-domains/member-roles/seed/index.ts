/**
 * Member-roles sub-domain seed contribution — `counts.customRolesPerOrg` custom roles per
 * registry organization, each with a varied permission subset (the member-role-permission grants
 * are seeded inline). Composed up into the tenancy domain's seed module after organizations and
 * the permission catalog exist.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedMemberRolesBulk } from './member-roles.bulk.seed.js';

/** Bulk-only contribution that seeds per-organization custom roles + permission grants. */
export const memberRolesSeedContribution: SeedContribution = {
  seedBulk: seedMemberRolesBulk,
};
