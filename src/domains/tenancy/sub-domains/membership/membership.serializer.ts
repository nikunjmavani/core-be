import type { MembershipOutput } from './membership.types.js';

/**
 * Shapes a `memberships` row into the HTTP response. Every identifier is an external public id:
 * the membership's own `public_id`, plus the organization, user, and role public ids resolved by
 * the caller. The internal sequential `user_id`/`role_id` on the row are NEVER emitted (they leak
 * enumerable ids and row counts). Timestamps become ISO-8601.
 */
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
  user_public_id: string,
  role_public_id: string,
): MembershipOutput {
  return {
    id: row.public_id,
    user_id: user_public_id,
    organization_id: organization_public_id,
    role_id: role_public_id,
    status: row.status,
    joined_at: row.joined_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
