import type { MemberRolePermissionOutput } from './member-role-permission.types.js';

export function serializeMemberRolePermission(
  row: { permission_code: string; created_at: Date },
  role_public_id: string,
): MemberRolePermissionOutput {
  return {
    role_id: role_public_id,
    permission_code: row.permission_code,
    created_at: row.created_at.toISOString(),
  };
}
