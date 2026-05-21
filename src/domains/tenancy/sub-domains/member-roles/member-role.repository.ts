import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { roles } from '@/domains/tenancy/sub-domains/member-roles/member-role.schema.js';
import { BaseRepository } from '@/infrastructure/database/base-repository.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { MemberRoleRow } from './member-role.types.js';

export class MemberRoleRepository extends BaseRepository {
  async findByOrganizationId(organization_id: number, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const where = and(eq(roles.organization_id, organization_id), isNull(roles.deleted_at));
    const [rows, countResult] = await Promise.all([
      getRequestDatabase()
        .select()
        .from(roles)
        .where(where)
        .orderBy(asc(roles.name))
        .limit(limit)
        .offset(offset),
      getRequestDatabase().select({ count: count() }).from(roles).where(where),
    ]);
    const total = countResult[0]?.count ?? 0;
    return this.paginate(rows as MemberRoleRow[], total, page, limit);
  }

  async findByPublicId(public_id: string, organization_id: number): Promise<MemberRoleRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(roles)
      .where(
        and(
          eq(roles.public_id, public_id),
          eq(roles.organization_id, organization_id),
          isNull(roles.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as MemberRoleRow | null;
  }

  async findByInternalId(
    role_internal_id: number,
    organization_id: number,
  ): Promise<MemberRoleRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(roles)
      .where(
        and(
          eq(roles.id, role_internal_id),
          eq(roles.organization_id, organization_id),
          isNull(roles.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as MemberRoleRow | null;
  }

  async create(data: {
    organization_id: number;
    name: string;
    description?: string | null;
    is_system?: boolean;
    created_by_user_id?: number | null;
  }) {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const row = {
        public_id,
        organization_id: data.organization_id,
        name: data.name,
        description: data.description ?? null,
        is_system: data.is_system ?? false,
        created_by_user_id: data.created_by_user_id ?? undefined,
        updated_by_user_id: data.created_by_user_id ?? undefined,
      };
      const rows = await getRequestDatabase().insert(roles).values(row).returning();
      return rows[0]! as MemberRoleRow;
    });
  }

  async update(
    public_id: string,
    organization_id: number,
    data: { name?: string; description?: string | null },
    updated_by_user_id: number | null,
  ): Promise<MemberRoleRow | null> {
    const rows = await getRequestDatabase()
      .update(roles)
      .set({
        ...data,
        updated_at: databaseNowTimestamp,
        updated_by_user_id: updated_by_user_id ?? undefined,
      })
      .where(
        and(
          eq(roles.public_id, public_id),
          eq(roles.organization_id, organization_id),
          isNull(roles.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as MemberRoleRow | null;
  }

  async softDelete(public_id: string, organization_id: number): Promise<MemberRoleRow | null> {
    const rows = await getRequestDatabase()
      .update(roles)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(roles.public_id, public_id),
          eq(roles.organization_id, organization_id),
          isNull(roles.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as MemberRoleRow | null;
  }
}
