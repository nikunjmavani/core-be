import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
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
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { organization, token };
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
    });
  });
});
