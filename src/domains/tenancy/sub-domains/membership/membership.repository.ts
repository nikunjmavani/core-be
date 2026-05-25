import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { BaseRepository } from '@/infrastructure/database/base-repository.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { MembershipRow } from './membership.types.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import {
  buildAscendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';

interface MembershipListPagination {
  after?: string;
  offset_page?: number;
  limit: number;
}

export class MembershipRepository extends BaseRepository {
  async findByOrganizationId(organization_id: number, pagination: MembershipListPagination) {
    const { after, offset_page, limit } = pagination;
    const cursorCondition =
      offset_page === undefined
        ? buildAscendingCreatedAtIdCursorCondition(
            memberships.created_at,
            memberships.id,
            parseListCursor(after),
          )
        : undefined;
    const where = and(
      eq(memberships.organization_id, organization_id),
      isNull(memberships.deleted_at),
      cursorCondition,
    );
    const rowsQuery = getRequestDatabase()
      .select()
      .from(memberships)
      .where(where)
      .orderBy(asc(memberships.created_at), asc(memberships.id))
      .limit(limit + 1);
    const [rows, countResult] = await Promise.all([
      offset_page !== undefined ? rowsQuery.offset((offset_page - 1) * limit) : rowsQuery,
      offset_page !== undefined
        ? getRequestDatabase().select({ count: count() }).from(memberships).where(where)
        : Promise.resolve([{ count: null }]),
    ]);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as MembershipRow[];
    const lastItem = items.at(-1);
    return {
      items,
      total: countResult[0]?.count ?? null,
      page: offset_page,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  async findById(id: number): Promise<MembershipRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, id), isNull(memberships.deleted_at)))
      .limit(1);
    return (rows[0] ?? null) as MembershipRow | null;
  }

  async findByUserAndOrganization(
    user_id: number,
    organization_id: number,
  ): Promise<MembershipRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.user_id, user_id),
          eq(memberships.organization_id, organization_id),
          isNull(memberships.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as MembershipRow | null;
  }

  async findByPublicId(public_id: string, organization_id: number): Promise<MembershipRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.public_id, public_id),
          eq(memberships.organization_id, organization_id),
          isNull(memberships.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as MembershipRow | null;
  }

  async create(data: {
    organization_id: number;
    user_id: number;
    role_id: number;
    status?: string;
    invited_by_user_id?: number | null;
    created_by_user_id?: number | null;
  }) {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const row = {
        public_id,
        organization_id: data.organization_id,
        user_id: data.user_id,
        role_id: data.role_id,
        status: data.status ?? 'INVITED',
        invited_by_user_id: data.invited_by_user_id ?? undefined,
        created_by_user_id: data.created_by_user_id ?? undefined,
        updated_by_user_id: data.created_by_user_id ?? undefined,
      };
      const rows = await getRequestDatabase().insert(memberships).values(row).returning();
      return rows[0]! as MembershipRow;
    });
  }

  async update(
    public_id: string,
    organization_id: number,
    data: { status?: string },
    updated_by_user_id: number | null,
  ): Promise<MembershipRow | null> {
    const payload: {
      status?: string;
      joined_at?: Date;
      updated_at: Date | SQL;
      updated_by_user_id?: number;
    } = omitUndefined({
      updated_at: databaseNowTimestamp,
      updated_by_user_id: updated_by_user_id ?? undefined,
    });
    if (data.status) payload.status = data.status;
    if (data.status === 'ACTIVE') payload.joined_at = new Date();
    const rows = await getRequestDatabase()
      .update(memberships)
      .set(payload)
      .where(
        and(
          eq(memberships.public_id, public_id),
          eq(memberships.organization_id, organization_id),
          isNull(memberships.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as MembershipRow | null;
  }

  async softDelete(public_id: string, organization_id: number): Promise<MembershipRow | null> {
    const rows = await getRequestDatabase()
      .update(memberships)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(memberships.public_id, public_id),
          eq(memberships.organization_id, organization_id),
          isNull(memberships.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as MembershipRow | null;
  }
}
