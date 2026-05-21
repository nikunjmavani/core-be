import { permissions } from '@/domains/tenancy/sub-domains/permission/permission.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { roles } from '@/domains/tenancy/sub-domains/member-roles/member-role.schema.js';
import { role_permissions } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { users } from '@/domains/user/user.schema.js';
import { DEFAULT_REPOSITORY_LIST_LIMIT } from '@/shared/constants/query-limits.constants.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export class PermissionRepository {
  async findAll(limit = DEFAULT_REPOSITORY_LIST_LIMIT) {
    const rows = await getRequestDatabase()
      .select()
      .from(permissions)
      .orderBy(permissions.category, permissions.code)
      .limit(limit);
    if (rows.length >= limit) {
      logger.warn(
        { limit, returned: rows.length },
        'PermissionRepository.findAll hit safe row cap; catalog may be truncated',
      );
    }
    return rows;
  }

  async findPermissionCodesForUserInOrganization(
    userPublicId: string,
    organizationPublicId: string,
    databaseHandle?: PostgresJsDatabase,
  ): Promise<string[]> {
    const database = databaseHandle ?? getRequestDatabase();
    const rows = await database
      .select({ permission_code: role_permissions.permission_code })
      .from(role_permissions)
      .innerJoin(roles, eq(role_permissions.role_id, roles.id))
      .innerJoin(memberships, eq(memberships.role_id, roles.id))
      .innerJoin(users, eq(memberships.user_id, users.id))
      .innerJoin(organizations, eq(memberships.organization_id, organizations.id))
      .where(
        and(
          eq(users.public_id, userPublicId),
          eq(organizations.public_id, organizationPublicId),
          eq(memberships.status, 'ACTIVE'),
          isNull(memberships.deleted_at),
          isNull(roles.deleted_at),
        ),
      );

    return rows.map((row) => row.permission_code);
  }
}
