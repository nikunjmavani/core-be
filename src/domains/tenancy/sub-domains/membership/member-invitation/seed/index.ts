/**
 * Member-invitation sub-domain seed contribution — a few pending invitations (with expired edge
 * cases) per registry organization, each backed by an INVITED membership. Composed up into the
 * tenancy domain's seed module after organizations and roles exist.
 */
import type { SeedContribution } from '@/scripts/seed/seed-contract.js';
import { seedMemberInvitationsBulk } from './member-invitation.bulk.seed.js';

/** Bulk-only contribution that seeds per-organization pending member invitations. */
export const memberInvitationSeedContribution: SeedContribution = {
  seedBulk: seedMemberInvitationsBulk,
};
