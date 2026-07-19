import type { MemberRoleOutput } from './member-role.types.js';

/**
 * Shapes a `roles` row into the public HTTP response. The internal numeric
 * primary key is dropped in favour of `public_id` (exposed as `id`); timestamps
 * are serialized as ISO-8601 strings. `member_count` — the number of ACTIVE or
 * INVITED members assigned this role — is supplied by the caller (the service
 * resolves it from a membership aggregate), mirroring how
 * {@link serializeMemberRolePermission} takes the role public id positionally.
 */
export function serializeMemberRole(
  row: {
    public_id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    created_at: Date;
    updated_at: Date;
  },
  member_count: number,
): MemberRoleOutput {
  return {
    id: row.public_id,
    name: row.name,
    description: row.description,
    is_system: row.is_system,
    member_count,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
