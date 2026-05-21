import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { member_invitations } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import type { MemberInvitationRow } from './member-invitation.types.js';

export class MemberInvitationRepository {
  async findByOrganizationId(organization_id: number, limit: number) {
    const rows = await getRequestDatabase()
      .select({
        invitation: member_invitations,
        membership_public_id: memberships.public_id,
      })
      .from(member_invitations)
      .innerJoin(memberships, eq(member_invitations.membership_id, memberships.id))
      .where(and(eq(memberships.organization_id, organization_id), isNull(memberships.deleted_at)))
      .orderBy(asc(member_invitations.created_at))
      .limit(limit);
    return rows.map((row) => ({
      ...row.invitation,
      membership_public_id: row.membership_public_id,
    }));
  }

  async findByEmailPending(email: string, limit: number) {
    const now = new Date();
    const rows = await getRequestDatabase()
      .select({
        invitation: member_invitations,
        membership_public_id: memberships.public_id,
        organization_public_id: organizations.public_id,
      })
      .from(member_invitations)
      .innerJoin(memberships, eq(member_invitations.membership_id, memberships.id))
      .innerJoin(organizations, eq(memberships.organization_id, organizations.id))
      .where(
        and(
          eq(member_invitations.email, email),
          isNull(member_invitations.accepted_at),
          isNull(member_invitations.revoked_at),
          gt(member_invitations.expires_at, now),
        ),
      )
      .orderBy(asc(member_invitations.created_at))
      .limit(limit);
    return rows;
  }

  async findByPublicId(public_id: string): Promise<MemberInvitationRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(member_invitations)
      .where(eq(member_invitations.public_id, public_id))
      .limit(1);
    return (rows[0] ?? null) as MemberInvitationRow | null;
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
      const public_id = generatePublicId();
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

  async accept(public_id: string): Promise<MemberInvitationRow | null> {
    const rows = await getRequestDatabase()
      .update(member_invitations)
      .set({ accepted_at: new Date() })
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
