import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { hashInvitationToken } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.token.js';
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

    it('should return memberships with permission', async () => {
      const { organization, token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
        token,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(200);
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
      const adminToken = await generateTestTokenWithActiveSession(app, admin.public_id);

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
        payload: {
          user_id: newMember.public_id,
          role_id: memberRole.public_id,
        },
      });
      expect(createMembershipResponse.statusCode).toBe(201);

      const memberToken = await generateTestTokenWithActiveSession(app, newMember.public_id);
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
        payload: {
          membership_id: membership.public_id,
          email: `route-invite-${Date.now()}@test.com`,
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
});
