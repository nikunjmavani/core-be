import { eq } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { role_permissions } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.schema.js';

export class MemberRolePermissionRepository {
  async findByRoleId(role_id: number) {
    return getRequestDatabase()
      .select()
      .from(role_permissions)
      .where(eq(role_permissions.role_id, role_id));
  }

  async replace(role_id: number, permission_codes: string[], created_by_user_id: number | null) {
    await getRequestDatabase()
      .delete(role_permissions)
      .where(eq(role_permissions.role_id, role_id));
    if (permission_codes.length === 0) return [];
    const rows = await getRequestDatabase()
      .insert(role_permissions)
      .values(
        permission_codes.map((permission_code) => ({
          role_id,
          permission_code,
          created_by_user_id: created_by_user_id ?? undefined,
        })),
      )
      .returning();
    return rows;
  }
}
