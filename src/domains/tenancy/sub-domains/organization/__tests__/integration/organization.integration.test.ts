import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
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
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const ORGANIZATION_PERMISSIONS = [
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
  TENANCY_PERMISSIONS.ORGANIZATION_UPDATE,
];

describe('Organization Sub-Domain — Integration', () => {
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
    await seedPermissions(ORGANIZATION_PERMISSIONS);
  });

  async function createAuthorizedContext(permissionCodes = ORGANIZATION_PERMISSIONS) {
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
    return { organization, token };
  }

  describe('GET /api/v1/tenancy/organizations', () => {
    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 200 for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('PATCH /api/v1/tenancy/organizations/:id', () => {
    it('returns 403 without organization update permission', async () => {
      const { organization } = await createAuthorizedContext([
        TENANCY_PERMISSIONS.ORGANIZATION_READ,
      ]);
      const user = await createTestUser({ email: 'no-update@test.com' });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token,
        organizationPublicId: organization.public_id,
        payload: { name: 'Renamed' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 or 422 for invalid body', async () => {
      const { organization, token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token,
        organizationPublicId: organization.public_id,
        payload: { unknown_field: true },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('concurrent slug updates to the same new slug resolve to one 200 + one 409 (no 5xx)', async () => {
      // One admin who owns two organizations races both to the SAME previously-unused slug.
      // Both requests pass the findBySlug pre-check (neither org holds it yet), so the loser
      // hits the idx_organizations_slug unique index — which must map to 409, never a 500.
      const user = await createTestUser();
      const [organizationA, organizationB] = await Promise.all([
        createTestOrganization({ ownerUserId: user.id }),
        createTestOrganization({ ownerUserId: user.id }),
      ]);
      const [roleA, roleB] = await Promise.all([
        createRoleWithPermissions({
          organizationId: organizationA.id,
          permissionCodes: ORGANIZATION_PERMISSIONS,
        }),
        createRoleWithPermissions({
          organizationId: organizationB.id,
          permissionCodes: ORGANIZATION_PERMISSIONS,
        }),
      ]);
      await Promise.all([
        createMembership({ userId: user.id, organizationId: organizationA.id, roleId: roleA.id }),
        createMembership({ userId: user.id, organizationId: organizationB.id, roleId: roleB.id }),
      ]);
      const token = await generateTestToken({ userId: user.public_id });

      const sharedSlug = 'race-shared-org-slug';
      const patchSlug = (organizationPublicId: string) =>
        injectAuthenticated(app, {
          method: 'PATCH',
          url: testApiPath(`/tenancy/organizations/${organizationPublicId}`),
          token,
          organizationPublicId,
          payload: { slug: sharedSlug },
        });

      const statuses = (
        await Promise.all([patchSlug(organizationA.public_id), patchSlug(organizationB.public_id)])
      ).map((response) => response.statusCode);

      expect(statuses.filter((status) => status >= 500)).toHaveLength(0);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    });
  });
});
