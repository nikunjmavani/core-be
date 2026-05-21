import type { MemberRoleOutput } from './member-role.types.js';

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
