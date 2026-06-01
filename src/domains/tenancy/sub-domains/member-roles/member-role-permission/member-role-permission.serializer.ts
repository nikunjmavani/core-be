import type { MemberRolePermissionOutput } from './member-role-permission.types.js';

/**
 * Shapes a `role_permissions` row into the HTTP response form, substituting the
 * role's external public id for the internal numeric `role_id`.
 */
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
