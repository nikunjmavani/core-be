import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { member_invitations } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.schema.js';
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
import { buildContainsLikePattern } from '@/shared/utils/http/list-query.util.js';

interface MembershipListPagination {
  after?: string;
  limit: number;
  /** Optional free-text search over the member's email / first name / last name. */
  q?: string;
}

/** Row shape returned by {@link MembershipRepository.listOrganizationsForUserDataExport}. */
export interface MembershipOrganizationUserDataExportRow {
  name: string;
  slug: string | null;
  status: string;
  created_at: Date;
}

/**
 * Raw user summary from {@link MembershipRepository.resolveUserSummariesByInternalIds}. `avatar_url`
 * is the RAW stored object key (or absolute provider URL) — the service presigns it before serializing.
 */
export interface MembershipUserSummaryRow {
  public_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

/** Raw role summary from {@link MembershipRepository.resolveRoleSummariesByInternalIds}. */
export interface MembershipRoleSummaryRow {
  public_id: string;
  name: string;
}

/** Raw live-invitation reference from {@link MembershipRepository.resolveLiveInvitationsByMembershipIds}. */
export interface MembershipInvitationRefRow {
  public_id: string;
  expires_at: Date;
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
    const { after, limit, q } = pagination;
    const cursor = parseListCursor(after);
    // Search restricts to the membership ids whose member's user email/name matches `q`. That match
    // needs a join to `auth.users` (FORCE RLS), which under org-only context can only be read through
    // the SECURITY DEFINER resolver — see searchMembershipIds. With no match, short-circuit to an
    // empty page; otherwise the normal typed keyset query below adds `id IN (...)`.
    let searchIdFilter: SQL | undefined;
    if (q !== undefined) {
      const matchingIds = await this.searchMembershipIds(organization_id, q);
      if (matchingIds.length === 0) {
        return {
          items: [] as MembershipRow[],
          total: null,
          limit,
          has_more: false,
          next_cursor: null,
        };
      }
      searchIdFilter = inArray(memberships.id, matchingIds);
    }
    const rows = await getRequestDatabase()
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organization_id, organization_id),
          isNull(memberships.deleted_at),
          searchIdFilter,
          buildAscendingCreatedAtIdCursorCondition(memberships.created_at, memberships.id, cursor),
        ),
      )
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
   * Resolves the membership ids in an organization whose member's user email / first name / last
   * name matches `q`. `auth.users` is FORCE RLS behind a self-owner policy, so under org-only context
   * a plain join matches zero rows — the search goes through the
   * `tenancy.search_organization_membership_ids` SECURITY DEFINER function (20260702000000), which
   * bypasses RLS by explicit organization scoping and exposes no `auth.users` columns. The term is
   * escaped into a `%…%` `ILIKE` pattern before binding.
   */
  private async searchMembershipIds(organization_id: number, q: string): Promise<number[]> {
    const pattern = buildContainsLikePattern(q);
    const result = await getRequestDatabase().execute(
      sql`SELECT id FROM tenancy.search_organization_membership_ids(${organization_id}::bigint, ${pattern}::text)`,
    );
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as { id: number | string }[];
    return rows.map((row) => Number(row.id));
  }

  /**
   * Maps internal user ids to display SUMMARIES (public id + email + name + raw avatar key) for the
   * membership serializer's embedded `user` object. `auth.users` is FORCE RLS (self-scoped) and
   * these reads run under org-only context, so a plain join would match zero rows under the app
   * role — delegate to the SECURITY DEFINER batch resolver (RLS bypass by ownership). Batched to
   * avoid an N+1 per list page; `avatar_url` is the RAW stored key — the service presigns it.
   */
  async resolveUserSummariesByInternalIds(
    userInternalIds: readonly number[],
  ): Promise<Map<number, MembershipUserSummaryRow>> {
    if (userInternalIds.length === 0) return new Map();
    // Build an explicit `ARRAY[...]::bigint[]` literal — drizzle can't bind a JS array as a single
    // parameter to the function's BIGINT[] argument.
    const userIdValues = sql.join(
      userInternalIds.map((userInternalId) => sql`${userInternalId}`),
      sql`, `,
    );
    const result = await getRequestDatabase().execute(
      sql`SELECT id, public_id, email, first_name, last_name, avatar_url FROM auth.resolve_user_summaries_by_ids(ARRAY[${userIdValues}]::bigint[])`,
    );
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as {
      id: number | string;
      public_id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
    }[];
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          public_id: row.public_id,
          email: row.email,
          first_name: row.first_name,
          last_name: row.last_name,
          avatar_url: row.avatar_url,
        },
      ]),
    );
  }

  /**
   * Maps internal role ids to summaries (public id + name) for the serializer's embedded `role`
   * object. `roles` is org-scoped, so a normal RLS-scoped query under the current org context is
   * correct (no resolver needed).
   */
  async resolveRoleSummariesByInternalIds(
    roleInternalIds: readonly number[],
  ): Promise<Map<number, MembershipRoleSummaryRow>> {
    if (roleInternalIds.length === 0) return new Map();
    const rows = await getRequestDatabase()
      .select({ id: roles.id, public_id: roles.public_id, name: roles.name })
      .from(roles)
      // audit #38: exclude soft-deleted roles so a membership referencing a deleted role does not
      // surface the deleted role's name in the member-list response (the serializer then falls
      // through to its `{ name: '' }` placeholder).
      .where(and(inArray(roles.id, [...roleInternalIds]), isNull(roles.deleted_at)));
    return new Map(rows.map((row) => [row.id, { public_id: row.public_id, name: row.name }]));
  }

  /**
   * Maps internal membership ids to their live (pending — not accepted, not revoked) invitation, so
   * the serializer can embed an `invitation` ref on `INVITED` rows (the frontend drives Resend /
   * Revoke from the members table). Runs under the org RLS context (`member_invitations` is scoped
   * to the org's memberships) — no SECURITY DEFINER needed. Ordered ascending so the newest live
   * invite wins for a membership with more than one historical row.
   */
  async resolveLiveInvitationsByMembershipIds(
    membershipInternalIds: readonly number[],
  ): Promise<Map<number, MembershipInvitationRefRow>> {
    if (membershipInternalIds.length === 0) return new Map();
    const rows = await getRequestDatabase()
      .select({
        membership_id: member_invitations.membership_id,
        public_id: member_invitations.public_id,
        expires_at: member_invitations.expires_at,
      })
      .from(member_invitations)
      .where(
        and(
          inArray(member_invitations.membership_id, [...membershipInternalIds]),
          isNull(member_invitations.accepted_at),
          isNull(member_invitations.revoked_at),
        ),
      )
      .orderBy(asc(member_invitations.created_at), asc(member_invitations.id));
    return new Map(
      rows.map((row) => [
        row.membership_id,
        { public_id: row.public_id, expires_at: row.expires_at },
      ]),
    );
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

  /**
   * Counts the seat-occupying memberships in an organization (REQ-4).
   *
   * @remarks
   * A "seat" is consumed by any membership that is either ACTIVE or still INVITED
   * (`deleted_at IS NULL`) — an outstanding invitation already reserves a seat so a
   * burst of invites cannot exceed the plan limit once everyone accepts. The count
   * is exact (no LIMIT) because it feeds a binary `used >= total` seat-availability
   * check; it is bounded by the per-org member cap. Mirrors {@link countActiveByRoleId}.
   * SUSPENDED members are intentionally NOT counted (a suspended seat is not in use).
   */
  async countActiveByOrganization(organization_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          eq(memberships.organization_id, organization_id),
          inArray(memberships.status, ['ACTIVE', 'INVITED']),
          isNull(memberships.deleted_at),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  /**
   * F2: suspends up to `suspend_count` non-owner ACTIVE members, most-recently-joined first.
   *
   * @remarks
   * - **Algorithm:** selects the candidate ids (`ACTIVE`, not the owner, not soft-deleted) ordered
   *   by `joined_at DESC` and capped at `suspend_count`, then flips them to `SUSPENDED` in one
   *   `UPDATE … WHERE id IN (…)`. Two steps (select then update) avoid a self-referential update
   *   subquery and let the caller log exactly how many were suspended.
   * - **Failure modes:** none beyond the underlying queries; runs inside the caller's organization
   *   DB context (RLS-scoped) and transaction.
   * - **Side effects:** writes `status = 'SUSPENDED'` (a suspended seat is not counted toward the
   *   cap, so this lowers the org's seat usage). Returns the internal `user_id`s actually suspended
   *   (empty when no non-owner ACTIVE members remain — e.g. an owner-only org that can't shrink
   *   further) so the caller can purge each suspended member's permission cache.
   */
  async suspendExcessActiveMembers(options: {
    organization_id: number;
    owner_user_id: number;
    suspend_count: number;
  }): Promise<number[]> {
    if (options.suspend_count <= 0) return [];
    const candidates = await getRequestDatabase()
      .select({ id: memberships.id, user_id: memberships.user_id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organization_id, options.organization_id),
          eq(memberships.status, 'ACTIVE'),
          ne(memberships.user_id, options.owner_user_id),
          isNull(memberships.deleted_at),
        ),
      )
      .orderBy(desc(memberships.joined_at))
      .limit(options.suspend_count);
    if (candidates.length === 0) return [];
    await getRequestDatabase()
      .update(memberships)
      .set({ status: 'SUSPENDED', updated_at: new Date() })
      .where(
        inArray(
          memberships.id,
          candidates.map((candidate) => candidate.id),
        ),
      );
    return candidates.map((candidate) => candidate.user_id);
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
    data: { status?: string; role_id?: number },
    updated_by_user_id: number | null,
  ): Promise<MembershipRow | null> {
    const payload: {
      status?: string;
      role_id?: number;
      joined_at?: Date;
      updated_at: Date | SQL;
      updated_by_user_id?: number;
    } = omitUndefined({
      updated_at: databaseNowTimestamp,
      updated_by_user_id: updated_by_user_id ?? undefined,
    });
    if (data.status) payload.status = data.status;
    if (data.status === 'ACTIVE') payload.joined_at = new Date();
    if (data.role_id !== undefined) payload.role_id = data.role_id;
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
