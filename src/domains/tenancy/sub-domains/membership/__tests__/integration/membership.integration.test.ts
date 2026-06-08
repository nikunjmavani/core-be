import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { database } from '@/infrastructure/database/connection.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  generateTestToken,
  generateTestTokenWithActiveSession,
} from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { MemberInvitationRepository } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.repository.js';
import { member_invitations } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { hashInvitationToken } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.token.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { FastifyInstance } from 'fastify';

const MEMBERSHIP_PERMISSIONS = [
  TENANCY_PERMISSIONS.MEMBERSHIP_READ,
  TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE,
  TENANCY_PERMISSIONS.INVITATION_MANAGE,
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
  TENANCY_PERMISSIONS.ORGANIZATION_UPDATE,
];

describe('Membership Sub-Domain — Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(MEMBERSHIP_PERMISSIONS);
  });

  async function createAuthorizedContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: MEMBERSHIP_PERMISSIONS,
    });
    const membership = await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { organization, token, membership, user };
  }

  describe('GET /api/v1/tenancy/organizations/:id/memberships', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations/some-id/memberships'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return memberships with permission, emitting public ids (not internal sequential ids)', async () => {
      const { organization, token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
        token,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        data?: { user_id: string; role_id: string }[];
      };
      const items = body.data ?? [];
      expect(items.length).toBeGreaterThan(0);
      const member = items[0]!;
      // 21-char public ids, never the internal bigserial ids ("1", "42", ...).
      expect(member.user_id).toMatch(/^[A-Za-z0-9]{21}$/);
      expect(member.role_id).toMatch(/^[A-Za-z0-9]{21}$/);
      expect(member.user_id).not.toMatch(/^\d+$/);
      expect(member.role_id).not.toMatch(/^\d+$/);
    });
  });

  describe('POST /api/v1/tenancy/organizations/:id/memberships', () => {
    it('seeds new member user settings from organization default_locale', async () => {
      const admin = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: admin.id });
      const adminRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: MEMBERSHIP_PERMISSIONS,
      });
      await createMembership({
        userId: admin.id,
        organizationId: organization.id,
        roleId: adminRole.id,
      });
      const { token: adminToken } = await generateTestTokenWithActiveSession(app, admin.public_id);

      const settingsPatch = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/settings`),
        token: adminToken,
        organizationPublicId: organization.public_id,
        payload: { default_locale: 'es' },
      });
      expect(settingsPatch.statusCode).toBe(200);

      const newMember = await createTestUser({ email: 'org-locale-member@test.com' });
      const memberRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.MEMBERSHIP_READ],
      });

      const createMembershipResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
        token: adminToken,
        organizationPublicId: organization.public_id,
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        payload: {
          user_id: newMember.public_id,
          role_id: memberRole.public_id,
        },
      });
      expect(createMembershipResponse.statusCode).toBe(201);

      const { token: memberToken } = await generateTestTokenWithActiveSession(
        app,
        newMember.public_id,
      );
      const settingsResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
        token: memberToken,
      });
      expect(settingsResponse.statusCode).toBe(200);
      const settingsData = (settingsResponse.json() as { data: Record<string, unknown> }).data;
      expect(settingsData.language).toBe('es');
      expect(settingsData.preferred_locales).toEqual(['es']);
    });

    it('rejects creating a membership directly as ACTIVE with 403 (not a 500)', async () => {
      const admin = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: admin.id });
      const adminRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: MEMBERSHIP_PERMISSIONS,
      });
      await createMembership({
        userId: admin.id,
        organizationId: organization.id,
        roleId: adminRole.id,
      });
      const { token: adminToken } = await generateTestTokenWithActiveSession(app, admin.public_id);
      const newMember = await createTestUser({ email: 'direct-active-member@test.com' });
      const memberRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.MEMBERSHIP_READ],
      });

      // Initial activation must come from invitation acceptance — a manager cannot mint an
      // already-active membership. This must be a clean 403, never a chk_memberships_joined 500.
      const activeResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
        token: adminToken,
        organizationPublicId: organization.public_id,
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        payload: {
          user_id: newMember.public_id,
          role_id: memberRole.public_id,
          status: 'ACTIVE',
        },
      });
      expect(activeResponse.statusCode).toBe(403);

      // The default (INVITED) path still works — the guard is specific to ACTIVE.
      const invitedResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
        token: adminToken,
        organizationPublicId: organization.public_id,
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        payload: {
          user_id: newMember.public_id,
          role_id: memberRole.public_id,
          status: 'INVITED',
        },
      });
      expect(invitedResponse.statusCode).toBe(201);
    });
  });

  describe('GET /api/v1/tenancy/organizations/:id/invitations', () => {
    it('should return invitations with manage permission', async () => {
      const { organization, token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/invitations`),
        token,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      expect(body.meta?.pagination).toMatchObject({ has_more: false, next: null });
    });

    it('paginates invitations with after cursor and include_total', {
      timeout: 30_000,
    }, async () => {
      const { organization, token, membership, user } = await createAuthorizedContext();
      const invitationRepository = new MemberInvitationRepository();
      const baseCreatedAt = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1_000;
      for (let index = 0; index < 3; index += 1) {
        const invitation = await invitationRepository.create({
          membership_id: membership.id,
          email: `cursor-invite-${index}-${baseCreatedAt}@test.com`,
          token_hash: hashInvitationToken(`token-${index}-${baseCreatedAt}`),
          invited_by_user_id: user.id,
          expires_at: new Date(Date.now() + oneDayMs),
          created_by_user_id: user.id,
        });
        await database
          .update(member_invitations)
          .set({ created_at: new Date(baseCreatedAt + index * 1_000) })
          .where(eq(member_invitations.id, invitation.id));
      }

      const page1Response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/invitations`),
        token,
        organizationPublicId: organization.public_id,
        query: { limit: '2', include_total: 'true' },
      });
      expect(page1Response.statusCode).toBe(200);
      const page1Body = page1Response.json() as {
        data: Array<{ id: string }>;
        meta?: {
          pagination?: {
            has_more?: boolean;
            next?: string | null;
            estimated_total?: number;
            per_page?: number;
          };
        };
      };
      expect(page1Body.data).toHaveLength(2);
      expect(page1Body.meta?.pagination).toMatchObject({
        has_more: true,
        per_page: 2,
        estimated_total: 3,
      });
      expect(page1Body.meta?.pagination?.next).toBeTypeOf('string');

      const page2Response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/invitations`),
        token,
        organizationPublicId: organization.public_id,
        query: { limit: '2', after: page1Body.meta!.pagination!.next! },
      });
      expect(page2Response.statusCode).toBe(200);
      const page2Body = page2Response.json() as {
        data: Array<{ id: string }>;
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      const page1Ids = new Set(page1Body.data.map((row) => row.id));
      for (const row of page2Body.data) {
        expect(page1Ids.has(row.id)).toBe(false);
      }
      expect(page1Body.data.length + page2Body.data.length).toBe(3);
      expect(page2Body.meta?.pagination).toMatchObject({ has_more: false, next: null });
    });

    it('creates invitation via POST and lists it on the first cursor page', {
      timeout: 30_000,
    }, async () => {
      const { organization, token, membership } = await createAuthorizedContext();
      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/invitations`),
        token,
        organizationPublicId: organization.public_id,
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        payload: {
          membership_id: membership.public_id,
          expires_in_days: 7,
        },
      });
      expect(createResponse.statusCode).toBe(201);

      const listResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/invitations`),
        token,
        organizationPublicId: organization.public_id,
        query: { limit: '10' },
      });
      expect(listResponse.statusCode).toBe(200);
      const listBody = listResponse.json() as { data: unknown[] };
      expect(listBody.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/v1/invitations/:invitationId/accept (membership activation)', () => {
    async function createPendingInvitation() {
      const { organization, token, user: admin } = await createAuthorizedContext();
      const invitee = await createTestUser({ email: `invitee-${randomUUID()}@test.com` });
      const memberRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.MEMBERSHIP_READ],
      });
      const [inviteeMembership] = await database
        .insert(memberships)
        .values({
          public_id: generatePublicId(),
          user_id: invitee.id,
          organization_id: organization.id,
          role_id: memberRole.id,
          status: 'INVITED',
        })
        .returning();
      const rawToken = `accept-token-${randomUUID()}`;
      const invitationRepository = new MemberInvitationRepository();
      const invitation = await invitationRepository.create({
        membership_id: inviteeMembership!.id,
        email: invitee.email,
        token_hash: hashInvitationToken(rawToken),
        invited_by_user_id: admin.id,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        created_by_user_id: admin.id,
      });
      return {
        organization,
        token,
        invitation,
        invitee,
        inviteeMembership: inviteeMembership!,
        rawToken,
      };
    }

    it('atomically activates the linked membership when the invitation is accepted', async () => {
      const { invitation, invitee, inviteeMembership, rawToken } = await createPendingInvitation();
      const inviteeToken = await generateTestToken({ userId: invitee.public_id });

      const acceptResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/tenancy/invitations/${invitation.public_id}/accept`),
        token: inviteeToken,
        payload: { token: rawToken },
      });
      expect(acceptResponse.statusCode).toBe(200);

      const [updated] = await database
        .select()
        .from(memberships)
        .where(eq(memberships.id, inviteeMembership.id));
      expect(updated!.status).toBe('ACTIVE');
      expect(updated!.joined_at).not.toBeNull();
    });

    it('rejects a manager PATCH that tries to activate a never-joined membership', async () => {
      const { organization, token, inviteeMembership } = await createPendingInvitation();

      const patchResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: testApiPath(
          `/tenancy/organizations/${organization.public_id}/memberships/${inviteeMembership.public_id}`,
        ),
        token,
        organizationPublicId: organization.public_id,
        payload: { status: 'ACTIVE' },
      });
      expect(patchResponse.statusCode).toBe(403);

      const [stillInvited] = await database
        .select()
        .from(memberships)
        .where(eq(memberships.id, inviteeMembership.id));
      expect(stillInvited!.status).toBe('INVITED');
      expect(stillInvited!.joined_at).toBeNull();
    });
  });

  describe('DELETE /api/v1/tenancy/organizations/:id/invitations/:invitationId (route-coverage gap-fill)', () => {
    async function createPendingInvitationForAdminRevoke() {
      const { organization, token: adminToken, user: admin } = await createAuthorizedContext();
      const invitee = await createTestUser({ email: `admin-revoke-${randomUUID()}@test.com` });
      const memberRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.MEMBERSHIP_READ],
      });
      const [inviteeMembership] = await database
        .insert(memberships)
        .values({
          public_id: generatePublicId(),
          user_id: invitee.id,
          organization_id: organization.id,
          role_id: memberRole.id,
          status: 'INVITED',
        })
        .returning();
      const invitationRepository = new MemberInvitationRepository();
      const invitation = await invitationRepository.create({
        membership_id: inviteeMembership!.id,
        email: invitee.email,
        token_hash: hashInvitationToken(`admin-revoke-token-${randomUUID()}`),
        invited_by_user_id: admin.id,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        created_by_user_id: admin.id,
      });
      return { organization, adminToken, invitation, inviteeMembership: inviteeMembership! };
    }

    it('admin revokes a pending invitation (204 + revoked_at set, membership unchanged)', async () => {
      const { organization, adminToken, invitation, inviteeMembership } =
        await createPendingInvitationForAdminRevoke();

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(
          `/tenancy/organizations/${organization.public_id}/invitations/${invitation.public_id}`,
        ),
        token: adminToken,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(204);

      const [revoked] = await database
        .select()
        .from(member_invitations)
        .where(eq(member_invitations.id, invitation.id));
      expect(revoked!.revoked_at).not.toBeNull();
      expect(revoked!.accepted_at).toBeNull();

      const [stillInvited] = await database
        .select()
        .from(memberships)
        .where(eq(memberships.id, inviteeMembership.id));
      expect(stillInvited!.status).toBe('INVITED');
      expect(stillInvited!.joined_at).toBeNull();
    });

    it('refuses cross-organization revoke attempts with 404 (tenant isolation)', async () => {
      const { organization: orgA, invitation } = await createPendingInvitationForAdminRevoke();
      // Build a SECOND independent org with its own admin trying to delete orgA's invitation.
      const { organization: orgB, token: orgBAdminToken } = await createAuthorizedContext();
      expect(orgA.id).not.toBe(orgB.id);

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(
          `/tenancy/organizations/${orgB.public_id}/invitations/${invitation.public_id}`,
        ),
        token: orgBAdminToken,
        organizationPublicId: orgB.public_id,
      });
      expect(response.statusCode).toBe(404);

      const [untouched] = await database
        .select()
        .from(member_invitations)
        .where(eq(member_invitations.id, invitation.id));
      expect(untouched!.revoked_at).toBeNull();
    });

    it('rejects non-admin (no invitation:manage permission) with 403', async () => {
      const { organization, invitation } = await createPendingInvitationForAdminRevoke();
      // Build a member of the same org with READ-only permissions.
      const readOnlyUser = await createTestUser({ email: `read-only-${randomUUID()}@test.com` });
      const readOnlyRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.MEMBERSHIP_READ],
      });
      await createMembership({
        userId: readOnlyUser.id,
        organizationId: organization.id,
        roleId: readOnlyRole.id,
      });
      const readOnlyToken = await generateTestToken({ userId: readOnlyUser.public_id });

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(
          `/tenancy/organizations/${organization.public_id}/invitations/${invitation.public_id}`,
        ),
        token: readOnlyToken,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(403);

      const [stillPending] = await database
        .select()
        .from(member_invitations)
        .where(eq(member_invitations.id, invitation.id));
      expect(stillPending!.revoked_at).toBeNull();
    });
  });

  describe('DELETE /api/v1/tenancy/organizations/:id/memberships/:membershipId', () => {
    it('refuses to remove the organization owner (403, no orphaned org)', async () => {
      const owner = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: owner.id });
      const adminRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: MEMBERSHIP_PERMISSIONS,
      });
      const ownerMembership = await createMembership({
        userId: owner.id,
        organizationId: organization.id,
        roleId: adminRole.id,
      });
      const { token } = await generateTestTokenWithActiveSession(app, owner.public_id);

      // Even an admin (here, the owner) cannot remove the owner's membership — ownership must be
      // transferred first, or the organization would be left without an owner.
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(
          `/tenancy/organizations/${organization.public_id}/memberships/${ownerMembership.public_id}`,
        ),
        token,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(403);

      const [stillActive] = await database
        .select()
        .from(memberships)
        .where(eq(memberships.id, ownerMembership.id));
      expect(stillActive!.deleted_at).toBeNull();
    });
  });
});
