import type { MemberRoleOutput } from './member-role.types.js';

/**
 * Shapes a `roles` row into the public HTTP response. The internal numeric
 * primary key is dropped in favour of `public_id` (exposed as `id`); timestamps
 * are serialized as ISO-8601 strings.
 */
export function serializeMemberRole(row: {
  public_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}): MemberRoleOutput {
  return {
    id: row.public_id,
    name: row.name,
    description: row.description,
    is_system: row.is_system,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
