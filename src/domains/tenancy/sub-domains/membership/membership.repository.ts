import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { roles } from '@/domains/tenancy/sub-domains/member-roles/member-role.schema.js';
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
  limit: number;
}

/** Row shape returned by {@link MembershipRepository.listOrganizationsForUserDataExport}. */
export interface MembershipOrganizationUserDataExportRow {
  name: string;
  slug: string | null;
  status: string;
  created_at: Date;
}

/**
 * Drizzle data access for `tenancy.memberships`. Active rows are filtered via
 * `deleted_at IS NULL` (soft-delete semantics) and a partial unique index
 * keeps the `(user_id, organization_id)` pair unique among active rows.
 * Listing uses a `(created_at, id)` keyset cursor; `update` flips
 * `joined_at` to `now()` when the status transitions to `ACTIVE`.
 */
export class MembershipRepository extends BaseRepository {
  async listOrganizationsForUserDataExport(
    user_id: number,
    limit: number,
  ): Promise<MembershipOrganizationUserDataExportRow[]> {
    return getRequestDatabase()
      .select({
        name: organizations.name,
        slug: organizations.slug,
        status: memberships.status,
        created_at: memberships.created_at,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organization_id, organizations.id))
      .where(
        and(
          eq(memberships.user_id, user_id),
          isNull(memberships.deleted_at),
          isNull(organizations.deleted_at),
        ),
      )
      .limit(limit);
  }

  async findByOrganizationId(organization_id: number, pagination: MembershipListPagination) {
    const { after, limit } = pagination;
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      memberships.created_at,
      memberships.id,
      parseListCursor(after),
    );
    const where = and(
      eq(memberships.organization_id, organization_id),
      isNull(memberships.deleted_at),
      cursorCondition,
    );
    const rows = await getRequestDatabase()
      .select()
      .from(memberships)
      .where(where)
      .orderBy(asc(memberships.created_at), asc(memberships.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows) as MembershipRow[];
    const lastItem = items.at(-1);
    return {
      items,
      total: null,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  /**
   * Maps internal user ids to public ids for serialization. `auth.users` is FORCE RLS
   * (self-scoped) and these reads run under org-only context, so a plain join would match zero
   * rows under the app role — delegate to the SECURITY DEFINER batch resolver (RLS bypass by
   * ownership). Batched to avoid an N+1 per list page; exposes only the public id.
   */
  async resolveUserPublicIdsByInternalIds(
    userInternalIds: readonly number[],
  ): Promise<Map<number, string>> {
    if (userInternalIds.length === 0) return new Map();
    // Build an explicit `ARRAY[...]::bigint[]` literal — drizzle can't bind a JS array as a single
    // parameter to the function's BIGINT[] argument.
    const userIdValues = sql.join(
      userInternalIds.map((userInternalId) => sql`${userInternalId}`),
      sql`, `,
    );
    const result = await getRequestDatabase().execute(
      sql`SELECT id, public_id FROM auth.resolve_user_public_ids_by_ids(ARRAY[${userIdValues}]::bigint[])`,
    );
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as { id: number | string; public_id: string }[];
    return new Map(rows.map((row) => [Number(row.id), row.public_id]));
  }

  /**
   * Maps internal role ids to public ids for serialization. `roles` is org-scoped, so a normal
   * RLS-scoped query under the current org context is correct (no resolver needed).
   */
  async resolveRolePublicIdsByInternalIds(
    roleInternalIds: readonly number[],
  ): Promise<Map<number, string>> {
    if (roleInternalIds.length === 0) return new Map();
    const rows = await getRequestDatabase()
      .select({ id: roles.id, public_id: roles.public_id })
      .from(roles)
      .where(inArray(roles.id, [...roleInternalIds]));
    return new Map(rows.map((row) => [row.id, row.public_id]));
  }

  async findById(id: number): Promise<MembershipRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, id), isNull(memberships.deleted_at)))
      .limit(1);
    return (rows[0] ?? null) as MembershipRow | null;
  }

  /**
   * Counts active memberships currently assigned to a role inside an organization.
   *
   * @remarks
   * Used by `MemberRoleService.delete` (sec-T3) to refuse role deletion when active
   * members would lose every permission. The count is exact (no LIMIT) because the
   * value is used in a binary decision (>0 → block), and `(role_id, organization_id)`
   * is well-indexed via the partial unique index on `(user_id, organization_id)`
   * plus the explicit `idx_memberships_role_id` if present — at worst this is a
   * sequential scan over a single org's membership rows, which is bounded by the
   * org member cap.
   */
  async countActiveByRoleId(role_id: number, organization_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          eq(memberships.role_id, role_id),
          eq(memberships.organization_id, organization_id),
          isNull(memberships.deleted_at),
        ),
      );
    return rows[0]?.count ?? 0;
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
      const public_id = generatePublicId('membership');
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

  /**
   * Activates a membership as part of accepting its invitation: flips the
   * status to `ACTIVE` and stamps `joined_at` only when the row is still
   * pending (`status <> 'ACTIVE'`). Scoped by internal membership id +
   * organization id so it runs inside the invitation-accept transaction
   * (shared `withOrganizationDatabaseContext` unit of work) and stays
   * idempotent for a membership that is already active.
   */
  async activateForInvitationAccept(
    membership_id: number,
    organization_id: number,
  ): Promise<MembershipRow | null> {
    const rows = await getRequestDatabase()
      .update(memberships)
      .set({ status: 'ACTIVE', joined_at: new Date(), updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(memberships.id, membership_id),
          eq(memberships.organization_id, organization_id),
          // route-audit-#1: ONLY a still-invited membership may be activated by accepting. Without
          // this a member an admin SUSPENDED (the per-org ban) could self-restore to ACTIVE by
          // accepting a still-pending invitation — including one suspended while INVITED, where
          // joined_at is still NULL (so a joined_at-only guard would miss it). Mirrors the PATCH
          // guard that already blocks INVITED→ACTIVE via the manager route; permission resolution
          // keys on status='ACTIVE', so this is the access kill-switch.
          eq(memberships.status, 'INVITED'),
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
          // Never soft-delete the current owner's membership — neither via the member's own "leave"
          // (which could race a concurrent transfer-to-them after its owner pre-check) nor via an
          // admin removing a member. The owner must transfer ownership first; otherwise the row is
          // left intact and the caller surfaces a clean Forbidden, so the org is never orphaned.
          sql`NOT EXISTS (
            SELECT 1 FROM ${organizations}
            WHERE ${organizations.id} = ${memberships.organization_id}
              AND ${organizations.owner_user_id} = ${memberships.user_id}
          )`,
        ),
      )
      .returning();
    return (rows[0] ?? null) as MembershipRow | null;
  }
}
