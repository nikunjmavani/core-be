import type {
  MembershipOutput,
  MembershipRoleSummary,
  MembershipUserSummary,
} from './membership.types.js';

/**
 * Shapes a `memberships` row into the HTTP response. Every identifier is an external public id:
 * the membership's own `public_id`, the organization public id, plus the user and role summaries
 * resolved by the caller (their `id` fields are the user/role public ids). The internal sequential
 * `user_id`/`role_id` on the row are NEVER emitted (they leak enumerable ids and row counts). The
 * flat `user_id`/`role_id` mirror `user.id`/`role.id` for back-compat; `invitation` is the live
 * pending invite (present only on `INVITED` rows). Timestamps become ISO-8601.
 */
export function serializeMembership(
  row: {
    public_id: string;
    status: string;
    joined_at: Date | null;
    created_at: Date;
    updated_at: Date;
  },
  organization_public_id: string,
  user: MembershipUserSummary,
  role: MembershipRoleSummary,
  invitation: { public_id: string; expires_at: Date } | null,
): MembershipOutput {
  return {
    id: row.public_id,
    user_id: user.id,
    organization_id: organization_public_id,
    role_id: role.id,
    status: row.status,
    joined_at: row.joined_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    user,
    role,
    invitation:
      invitation === null
        ? null
        : { id: invitation.public_id, expires_at: invitation.expires_at.toISOString() },
  };
}
