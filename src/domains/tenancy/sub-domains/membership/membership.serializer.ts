import type { MembershipOutput } from './membership.types.js';

export function serializeMembership(
  row: {
    public_id: string;
    user_id: number;
    organization_id: number;
    role_id: number;
    status: string;
    joined_at: Date | null;
    created_at: Date;
    updated_at: Date;
  },
  organization_public_id: string,
): MembershipOutput {
  return {
    id: row.public_id,
    user_id: String(row.user_id),
    organization_id: organization_public_id,
    role_id: String(row.role_id),
    status: row.status,
    joined_at: row.joined_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
