import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import type { FastifyInstance } from 'fastify';

const ROLE_PERMISSIONS = [
  TENANCY_PERMISSIONS.ROLE_READ,
  TENANCY_PERMISSIONS.ROLE_MANAGE,
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
];

describe('Member Roles Sub-Domain — Integration', () => {
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
    await seedPermissions(ROLE_PERMISSIONS);
  });

  async function createAuthorizedContext(permissionCodes = ROLE_PERMISSIONS) {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { organization, role, token };
  }

  describe('GET /api/v1/tenancy/organizations/:id/roles', () => {
    it('should return 403 without role read permission', async () => {
      const { organization } = await createAuthorizedContext([
        TENANCY_PERMISSIONS.ORGANIZATION_READ,
      ]);
      const user = await createTestUser({ email: 'norole@test.com' });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
        token,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return roles with permission', async () => {
      const { organization, token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
        token,
        organizationPublicId: organization.public_id,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('PUT /api/v1/tenancy/organizations/:id/roles/:roleId/permissions', () => {
    it('should replace role permissions', async () => {
      const { organization, token } = await createAuthorizedContext();
      const targetRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.ROLE_READ],
      });
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath(
          `/tenancy/organizations/${organization.public_id}/roles/${targetRole.public_id}/permissions`,
        ),
        token,
        organizationPublicId: organization.public_id,
        payload: { permission_codes: [TENANCY_PERMISSIONS.ORGANIZATION_READ] },
      });
      expect([200, 204]).toContain(response.statusCode);
    });
  });
});
