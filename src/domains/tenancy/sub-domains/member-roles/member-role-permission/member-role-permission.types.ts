/**
 * HTTP response shape for a single role-to-permission assignment. `role_id`
 * carries the role's external public id; timestamps are ISO-8601 strings.
 */
export interface MemberRolePermissionOutput {
  role_id: string;
  permission_code: string;
  created_at: string;
}
