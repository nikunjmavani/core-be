import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
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
import type { FastifyInstance } from 'fastify';

const ALL_TENANCY_PERMISSIONS = Object.values(TENANCY_PERMISSIONS);

describe('Tenancy Domain — Integration', () => {
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
    await seedPermissions(ALL_TENANCY_PERMISSIONS);
  });

  // ─── Helper: create user with full org permissions ────────────
  async function createAuthorizedUserAndOrganization(permissionCodes = ALL_TENANCY_PERMISSIONS) {
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
    return { user, organization, role, token };
  }

  // ─── Organizations ────────────────────────────────────────────

  describe('GET /api/v1/tenancy/organizations', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return organizations for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });
  });

  describe('POST /api/v1/tenancy/organizations', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should create organization for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        token: token,
        headers: { 'idempotency-key': `idem-${randomUUID()}` },
        payload: { name: 'Test Org', slug: 'test-org' },
      });
      expect(response.statusCode).toBe(201);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
      expect((response.json() as { data: Record<string, unknown> }).data.name).toBe('Test Org');
    });
  });

  describe('GET /api/v1/tenancy/organizations/:id', () => {
    it('should return organization by public ID', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token: token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });

    it('should return 404 for non-existent organization', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations/zzzzzzzzzzzzzzzzzzzzz'),
        token: token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/v1/tenancy/organizations/:id', () => {
    it('should return 403 without update permission', async () => {
      const authorized = await createAuthorizedUserAndOrganization([
        TENANCY_PERMISSIONS.ORGANIZATION_READ,
      ]);
      const otherUser = await createTestUser({ email: 'other@test.com' });
      const { organization } = authorized;
      const readRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.ORGANIZATION_READ],
      });
      await createMembership({
        userId: otherUser.id,
        organizationId: organization.id,
        roleId: readRole.id,
      });
      const otherToken = await generateTestToken({ userId: otherUser.public_id });

      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token: otherToken,
        payload: { name: 'Updated' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should update organization with update permission', async () => {
      const { organization, token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token: token,
        payload: { name: 'Updated Org' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/tenancy/organizations/:id', () => {
    it('should return 403 without delete permission', async () => {
      const { organization } = await createAuthorizedUserAndOrganization();
      const otherUser = await createTestUser({ email: 'other2@test.com' });
      const readRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.ORGANIZATION_READ],
      });
      await createMembership({
        userId: otherUser.id,
        organizationId: organization.id,
        roleId: readRole.id,
      });
      const otherToken = await generateTestToken({ userId: otherUser.public_id });
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token: otherToken,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should soft-delete organization and hide it from subsequent reads', async () => {
      const { organization, token } = await createAuthorizedUserAndOrganization();
      const deleteResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token: token,
        organizationPublicId: organization.public_id,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
        token: token,
        organizationPublicId: organization.public_id,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/tenancy/organizations/by-slug/:slug', () => {
    it('should return organization by slug', async () => {
      const user = await createTestUser();
      await createTestOrganization({
        ownerUserId: user.id,
        slug: 'my-org',
      });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organizations/by-slug/my-org'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── Permissions (authenticated catalog) ────────────────────

  describe('GET /api/v1/tenancy/permissions', () => {
    it('should list all permissions', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/permissions'),
        token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });

    it('returns cache headers and 304 on repeat fetch with If-None-Match', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const firstResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/permissions'),
        token,
      });
      expect(firstResponse.statusCode).toBe(200);
      const etag = firstResponse.headers.etag;
      expect(etag).toBeDefined();
      expect(firstResponse.headers['cache-control']).toContain('max-age=300');

      const secondResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/permissions'),
        token,
        headers: { 'if-none-match': String(etag) },
      });
      expect(secondResponse.statusCode).toBe(304);
      expect(secondResponse.body).toBe('');
    });
  });
});
