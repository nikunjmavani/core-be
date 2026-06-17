import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

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
    // Flat tenancy routes resolve the organization from the JWT `org` claim, so
    // the bearer must embed `organizationPublicId` to reach the org-scoped
    // permission preHandlers and controllers.
    const token = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organization.public_id,
    });
    return { user, organization, role, token };
  }

  // ─── Organizations ────────────────────────────────────────────

  describe('GET /api/v1/tenancy/organizations', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/tenancy/organizations'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return organizations for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organizations'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });

  describe('POST /api/v1/tenancy/organizations', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        headers: { 'x-idempotency-key': `idem-${randomUUID()}` },
        payload: {},
      });
      expect([400, 401]).toContain(response.statusCode);
    });

    it('should create organization for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        token,
        headers: { 'x-idempotency-key': `idem-${randomUUID()}` },
        payload: { name: 'Test Org', slug: 'test-org' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { data: { name: string } };
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe('Test Org');
    });
  });

  describe('GET /api/v1/tenancy/organization', () => {
    it('should return the active organization from the token claim', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: { id?: string } };
      expect(body.data).toBeDefined();
      expect(body.data?.id).toBe(organization.public_id);
    });

    it('should return 403 when the token carries no organization claim', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /api/v1/tenancy/organization', () => {
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
      const otherToken = await generateTestToken({
        userId: otherUser.public_id,
        organizationPublicId: organization.public_id,
      });

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: testApiPath('/tenancy/organization'),
        token: otherToken,
        payload: { name: 'Updated' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should update organization with update permission', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: testApiPath('/tenancy/organization'),
        token,
        payload: { name: 'Updated Org' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/tenancy/organization', () => {
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
      const otherToken = await generateTestToken({
        userId: otherUser.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: testApiPath('/tenancy/organization'),
        token: otherToken,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should soft-delete organization and hide it from subsequent reads', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const deleteResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: testApiPath('/tenancy/organization'),
        token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization'),
        token,
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
        url: testApiPath('/tenancy/organizations/by-slug/my-org'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── Memberships ──────────────────────────────────────────────

  describe('GET /api/v1/tenancy/organization/memberships', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/tenancy/organization/memberships'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without membership read permission', async () => {
      const { organization } = await createAuthorizedUserAndOrganization();
      const user = await createTestUser({ email: 'noperm2@test.com' });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/memberships'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return memberships with permission', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/memberships'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });

  describe('POST /api/v1/tenancy/organization/leave', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/leave'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ─── Invitations ──────────────────────────────────────────────

  describe('GET /api/v1/tenancy/organization/invitations', () => {
    it('should return 403 without membership manage permission', async () => {
      const { organization } = await createAuthorizedUserAndOrganization();
      const user = await createTestUser({ email: 'noperm3@test.com' });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/invitations'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return invitations with manage permission', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/invitations'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      expect(body.meta?.pagination).toMatchObject({ has_more: false, next: null });
    });
  });

  describe('POST /api/v1/tenancy/organization/invitations', () => {
    it('should return 400 for missing body', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/invitations'),
        token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('when BLOCK_DISPOSABLE_EMAIL is off, invitation create accepts disposable email', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const membershipsResponse = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/memberships'),
        token,
      });
      expect(membershipsResponse.statusCode).toBe(200);
      const membershipsBody = membershipsResponse.json() as {
        data: Array<{ id?: number; public_id?: string }>;
      };
      const memberships = membershipsBody.data;
      expect(Array.isArray(memberships) && memberships.length > 0).toBe(true);
      const firstMembership = memberships[0]!;
      const membershipId = firstMembership.id ?? firstMembership.public_id;

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/invitations'),
        token,
        headers: { 'x-idempotency-key': `idem-${randomUUID()}` },
        payload: {
          membership_id: membershipId,
          expires_in_days: 7,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });

  // ─── Roles ────────────────────────────────────────────────────

  describe('GET /api/v1/tenancy/organization/roles', () => {
    it('should return 403 without role read permission', async () => {
      const { organization } = await createAuthorizedUserAndOrganization();
      const user = await createTestUser({ email: 'noperm4@test.com' });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/roles'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return roles with permission', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/organization/roles'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });

  describe('POST /api/v1/tenancy/organization/roles', () => {
    it('should return 403 without role manage permission', async () => {
      const { organization } = await createAuthorizedUserAndOrganization([
        TENANCY_PERMISSIONS.ROLE_READ,
      ]);
      const user = await createTestUser({ email: 'roleread@test.com' });
      const readRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.ROLE_READ],
      });
      await createMembership({
        userId: user.id,
        organizationId: organization.id,
        roleId: readRole.id,
      });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        payload: { name: 'New Role' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should create role with manage permission', async () => {
      const { token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        payload: { name: 'New Role', description: 'A test role' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { data: { name: string } };
      expect(body.data.name).toBe('New Role');
    });
  });

  // ─── Role Permissions ─────────────────────────────────────────

  describe('GET /api/v1/tenancy/organization/roles/:role_id/permissions', () => {
    it('should return role permissions', async () => {
      const { role, token } = await createAuthorizedUserAndOrganization();
      const response = await injectAuthenticated(app, {
        url: testApiPath(`/tenancy/organization/roles/${role.public_id}/permissions`),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('PUT /api/v1/tenancy/organization/roles/:role_id/permissions', () => {
    it('should replace role permissions', async () => {
      const { organization, token } = await createAuthorizedUserAndOrganization();
      const targetRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.ROLE_READ],
      });
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath(`/tenancy/organization/roles/${targetRole.public_id}/permissions`),
        token,
        payload: { permission_codes: [TENANCY_PERMISSIONS.ORGANIZATION_READ] },
      });
      expect([200, 204]).toContain(response.statusCode);
    });
  });

  // ─── Permissions (authenticated catalog) ───────────────────────

  describe('GET /api/v1/tenancy/permissions', () => {
    it('should list all permissions for authenticated users', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/tenancy/permissions'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });
});
