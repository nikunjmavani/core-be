import type { MemberInvitationOutput } from './member-invitation.types.js';

export function serializeMemberInvitation(
  row: {
    public_id: string;
    membership_id: number;
    email: string;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  },
  membership_public_id: string,
): MemberInvitationOutput {
  return {
    id: row.public_id,
    membership_id: membership_public_id,
    email: row.email,
    expires_at: row.expires_at.toISOString(),
    accepted_at: row.accepted_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}
