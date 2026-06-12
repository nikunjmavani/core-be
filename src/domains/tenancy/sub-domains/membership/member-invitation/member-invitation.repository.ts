import { and, asc, count, eq, gt, isNull, type SQL } from 'drizzle-orm';
import { sql } from '@/infrastructure/database/connection.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { member_invitations } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { MemberInvitationRow } from './member-invitation.types.js';
import {
  buildAscendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';

/**
 * Cross-organization lookup result returned by the SECURITY DEFINER
 * `tenancy.resolve_member_invitation_lookup_by_public_id` function. Used by
 * `MemberInvitationService.accept/decline` so the caller can resolve the owning
 * organization without RLS context, then wrap the actual UPDATE in
 * `withOrganizationDatabaseContext`.
 */
export interface MemberInvitationOrganizationLookupRow {
  organization_public_id: string;
  organization_id: number;
  membership_public_id: string;
  membership_id: number;
}

/**
 * Result row returned by the SECURITY DEFINER function
 * `tenancy.list_pending_member_invitations_for_email`, used by the
 * cross-organization "list my pending invitations" endpoint. Carries only the
 * non-sensitive metadata required to render the invitation list — secret token
 * hashes and inviter ids are intentionally omitted.
 */
export interface PendingMemberInvitationLookupRow {
  invitation_public_id: string;
  organization_public_id: string;
  organization_id: number;
  membership_public_id: string;
  membership_id: number;
  invitation_email: string;
  invitation_expires_at: Date;
  invitation_created_at: Date;
}

/**
 * Cursor-pagination options for {@link MemberInvitationRepository.findByOrganizationId}.
 * Setting `include_total` to `true` opts in to a parallel `COUNT(*)` query for
 * pagination summaries.
 */
export interface MemberInvitationListPagination {
  after?: string;
  limit: number;
  include_total?: boolean;
}

/**
 * Drizzle data access for `tenancy.member_invitations`. Org-scoped reads
 * (listing, find-by-public-id, accept/revoke/resend updates) run under the
 * caller's RLS context; cross-org lookups by email or by invitation public id
 * use SECURITY DEFINER SQL functions so the public accept/decline flows can
 * resolve the owning organization without an org GUC set up front.
 */
export class MemberInvitationRepository {
  async findByOrganizationId(organization_id: number, pagination: MemberInvitationListPagination) {
    const { after, limit } = pagination;
    const includeTotal = pagination.include_total === true;
    const filterConditions: SQL[] = [
      eq(memberships.organization_id, organization_id),
      isNull(memberships.deleted_at),
    ];
    const countWhere = and(...filterConditions);
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      member_invitations.created_at,
      member_invitations.id,
      parseListCursor(after),
    );
    const where =
      cursorCondition !== undefined ? and(...filterConditions, cursorCondition) : countWhere;

    const rowsPromise = getRequestDatabase()
      .select({
        invitation: member_invitations,
        membership_public_id: memberships.public_id,
      })
      .from(member_invitations)
      .innerJoin(memberships, eq(member_invitations.membership_id, memberships.id))
      .where(where)
      .orderBy(asc(member_invitations.created_at), asc(member_invitations.id))
      .limit(limit + 1);

    const countPromise = includeTotal
      ? getRequestDatabase()
          .select({ count: count() })
          .from(member_invitations)
          .innerJoin(memberships, eq(member_invitations.membership_id, memberships.id))
          .where(countWhere)
          .then((rows) => rows[0]?.count ?? 0)
      : Promise.resolve(null);

    const [fetchedRows, total] = await Promise.all([rowsPromise, countPromise]);
    const hasMore = fetchedRows.length > limit;
    const rows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    const items = rows.map((row) => ({
      ...row.invitation,
      membership_public_id: row.membership_public_id,
    }));
    const lastItem = items.at(-1);
    return {
      items,
      total,
      limit,
      has_more: hasMore,
      next_cursor: hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null,
    };
  }

  /**
   * Cross-organization lookup of pending invitations by recipient email.
   *
   * Bypasses tenant RLS via the SECURITY DEFINER function
   * `tenancy.list_pending_member_invitations_for_email` so the route can be served
   * without an `app.current_organization_id` GUC. The function returns minimal
   * non-sensitive metadata; the secret token hash and inviter id are not exposed.
   */
  async findByEmailPending(
    email: string,
    limit: number,
  ): Promise<PendingMemberInvitationLookupRow[]> {
    const rows = await sql<
      Array<{
        invitation_public_id: string;
        organization_public_id: string;
        organization_id: string | number;
        membership_public_id: string;
        membership_id: string | number;
        invitation_email: string;
        invitation_expires_at: Date;
        invitation_created_at: Date;
      }>
    >`
      SELECT
        invitation_public_id,
        organization_public_id,
        organization_id,
        membership_public_id,
        membership_id,
        invitation_email,
        invitation_expires_at,
        invitation_created_at
      FROM tenancy.list_pending_member_invitations_for_email(${email}, ${limit})
    `;
    return rows.map((row) => ({
      invitation_public_id: row.invitation_public_id,
      organization_public_id: row.organization_public_id,
      organization_id: Number(row.organization_id),
      membership_public_id: row.membership_public_id,
      membership_id: Number(row.membership_id),
      invitation_email: row.invitation_email,
      invitation_expires_at: new Date(row.invitation_expires_at),
      invitation_created_at: new Date(row.invitation_created_at),
    }));
  }

  async findByPublicId(public_id: string): Promise<MemberInvitationRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(member_invitations)
      .where(eq(member_invitations.public_id, public_id))
      .limit(1);
    return (rows[0] ?? null) as MemberInvitationRow | null;
  }

  /**
   * Cross-organization lookup of an invitation's owning organization by public id.
   *
   * Bypasses tenant RLS via the SECURITY DEFINER function
   * `tenancy.resolve_member_invitation_lookup_by_public_id` so the public accept
   * route and the user-driven decline route can resolve the organization without
   * having `app.current_organization_id` set up front.
   */
  async lookupOrganizationByInvitationPublicId(
    invitation_public_id: string,
  ): Promise<MemberInvitationOrganizationLookupRow | null> {
    const rows = await sql<
      Array<{
        organization_public_id: string;
        organization_id: string | number;
        membership_public_id: string;
        membership_id: string | number;
      }>
    >`
      SELECT
        organization_public_id,
        organization_id,
        membership_public_id,
        membership_id
      FROM tenancy.resolve_member_invitation_lookup_by_public_id(${invitation_public_id})
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      organization_public_id: row.organization_public_id,
      organization_id: Number(row.organization_id),
      membership_public_id: row.membership_public_id,
      membership_id: Number(row.membership_id),
    };
  }

  async create(data: {
    membership_id: number;
    email: string;
    token_hash: string;
    invited_by_user_id: number;
    expires_at: Date;
    created_by_user_id?: number | null;
  }) {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId('memberInvitation');
      const rows = await getRequestDatabase()
        .insert(member_invitations)
        .values({
          public_id,
          membership_id: data.membership_id,
          email: data.email,
          token_hash: data.token_hash,
          invited_by_user_id: data.invited_by_user_id,
          expires_at: data.expires_at,
          ...(data.created_by_user_id !== undefined &&
            data.created_by_user_id !== null && {
              created_by_user_id: data.created_by_user_id,
            }),
        })
        .returning();
      return rows[0]! as MemberInvitationRow;
    });
  }

  async accept(
    public_id: string,
    token_hash: string,
    expires_after: Date,
  ): Promise<MemberInvitationRow | null> {
    const rows = await getRequestDatabase()
      .update(member_invitations)
      .set({ accepted_at: new Date() })
      .where(
        and(
          eq(member_invitations.public_id, public_id),
          eq(member_invitations.token_hash, token_hash),
          gt(member_invitations.expires_at, expires_after),
          isNull(member_invitations.accepted_at),
          isNull(member_invitations.revoked_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as MemberInvitationRow | null;
  }

  async resend(
    public_id: string,
    token_hash: string,
    expires_at: Date,
  ): Promise<MemberInvitationRow | null> {
    const rows = await getRequestDatabase()
      .update(member_invitations)
      .set({ token_hash, expires_at })
      .where(
        and(
          eq(member_invitations.public_id, public_id),
          isNull(member_invitations.accepted_at),
          isNull(member_invitations.revoked_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as MemberInvitationRow | null;
  }

  async revoke(public_id: string): Promise<MemberInvitationRow | null> {
    const rows = await getRequestDatabase()
      .update(member_invitations)
      .set({ revoked_at: new Date() })
      .where(
        and(eq(member_invitations.public_id, public_id), isNull(member_invitations.accepted_at)),
      )
      .returning();
    return (rows[0] ?? null) as MemberInvitationRow | null;
  }
}
