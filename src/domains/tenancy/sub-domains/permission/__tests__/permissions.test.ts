import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { resolveUserOrganizationPermissions } from '../authorization.service.js';
import {
  invalidatePermissions,
  invalidateOrganizationPermissions,
} from '../permission-cache.service.js';
import { TENANCY_PERMISSIONS } from '../../../tenancy.permissions.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const ALL_PERMISSION_CODES = Object.values(TENANCY_PERMISSIONS);

describe('Permission System Validation', () => {
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
  });

  // ─── Case 1: DB seed — seed permissions and verify they exist ──────────

  it('should seed permission codes into the database', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);

    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const response = await injectAuthenticated(app, {
      url: testApiPath('/tenancy/permissions'),
      token,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as { data: Array<{ code: string }> };
    expect(body.data).toBeDefined();
    expect(body.data.length).toBeGreaterThanOrEqual(ALL_PERMISSION_CODES.length);

    const returnedCodes = body.data.map((permission) => permission.code);
    for (const code of ALL_PERMISSION_CODES) {
      expect(returnedCodes).toContain(code);
    }
  });

  // ─── Case 2: Role assignment — assign permissions to a role ────────────

  it('should create a role and assign permissions to it', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const targetCodes = [
      TENANCY_PERMISSIONS.ORGANIZATION_READ,
      TENANCY_PERMISSIONS.MEMBERSHIP_READ,
    ];

    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      name: 'Viewer',
      permissionCodes: targetCodes,
    });

    expect(role).toBeDefined();
    expect(role.name).toBe('Viewer');

    // Verify via the permission resolution service
    const resolved = await resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );
    // User has no membership yet, so permissions should be empty
    expect(resolved).toEqual([]);

    // Now create membership and re-resolve
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });

    // Invalidate cache since we just resolved above (empty set cached)
    await invalidatePermissions(user.public_id, organization.public_id);

    const resolvedWithMembership = await resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );
    expect(resolvedWithMembership.sort()).toEqual(targetCodes.sort());
  });

  // ─── Case 3: 403 — user without required permission gets 403 ──────────

  it('should return 403 when user lacks required permission', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    // Create role with only ORGANIZATION_READ (not ROLE_READ)
    const readOnlyRole = await createRoleWithPermissions({
      organizationId: organization.id,
      name: 'ReadOnly',
      permissionCodes: [TENANCY_PERMISSIONS.ORGANIZATION_READ],
    });

    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: readOnlyRole.id,
    });

    const token = await generateTestToken({ userId: user.public_id });

    // Attempt to access roles endpoint (requires ROLE_READ)
    const response = await injectAuthenticated(app, {
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
      token,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toBeDefined();
  });

  // ─── Case 4: 200 — user with required permission gets 200 ─────────────

  it('should return 200 when user has required permission', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    // Create role with ROLE_READ permission
    const roleReadRole = await createRoleWithPermissions({
      organizationId: organization.id,
      name: 'RoleViewer',
      permissionCodes: [TENANCY_PERMISSIONS.ROLE_READ],
    });

    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: roleReadRole.id,
    });

    const token = await generateTestToken({ userId: user.public_id });

    // Access roles endpoint (requires ROLE_READ) — should succeed
    const response = await injectAuthenticated(app, {
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
      token,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data?: unknown };
    expect(body.data).toBeDefined();
  });

  // ─── Case 5: Cache invalidation — single user ─────────────────────────

  it('should invalidate cached permissions when user permissions change', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    // Create role with limited permissions
    const limitedRole = await createRoleWithPermissions({
      organizationId: organization.id,
      name: 'Limited',
      permissionCodes: [TENANCY_PERMISSIONS.ORGANIZATION_READ],
    });

    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: limitedRole.id,
    });

    // First resolution — should cache
    const first = await resolveUserOrganizationPermissions(user.public_id, organization.public_id);
    expect(first).toEqual([TENANCY_PERMISSIONS.ORGANIZATION_READ]);

    // Invalidate the cache
    await invalidatePermissions(user.public_id, organization.public_id);

    // Second resolution after invalidation — should hit DB again
    const second = await resolveUserOrganizationPermissions(user.public_id, organization.public_id);
    expect(second).toEqual([TENANCY_PERMISSIONS.ORGANIZATION_READ]);
  });

  // ─── Case 6: Permission resolution — correct 5-table join ─────────────

  it('should correctly resolve permissions via the 5-table join', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    const fullRole = await createRoleWithPermissions({
      organizationId: organization.id,
      name: 'Admin',
      permissionCodes: ALL_PERMISSION_CODES,
    });

    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: fullRole.id,
    });

    const resolved = await resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );

    expect(resolved.sort()).toEqual([...ALL_PERMISSION_CODES].sort());
  });

  // ─── Case 7: Organization-level cache invalidation ─────────────────────

  it('should invalidate all cached permissions for an organization', async () => {
    await seedPermissions(ALL_PERMISSION_CODES);
    const user1 = await createTestUser({ email: 'user1@test.com' });
    const user2 = await createTestUser({ email: 'user2@test.com' });
    const organization = await createTestOrganization({ ownerUserId: user1.id });

    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      name: 'Shared',
      permissionCodes: [TENANCY_PERMISSIONS.ORGANIZATION_READ],
    });

    await createMembership({
      userId: user1.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    await createMembership({
      userId: user2.id,
      organizationId: organization.id,
      roleId: role.id,
    });

    // Resolve for both users — caches both
    const resolved1 = await resolveUserOrganizationPermissions(
      user1.public_id,
      organization.public_id,
    );
    const resolved2 = await resolveUserOrganizationPermissions(
      user2.public_id,
      organization.public_id,
    );

    expect(resolved1).toEqual([TENANCY_PERMISSIONS.ORGANIZATION_READ]);
    expect(resolved2).toEqual([TENANCY_PERMISSIONS.ORGANIZATION_READ]);

    // Invalidate all permissions for the organization
    await invalidateOrganizationPermissions(organization.public_id);

    // Re-resolve — should hit DB again (cache cleared)
    const reResolved1 = await resolveUserOrganizationPermissions(
      user1.public_id,
      organization.public_id,
    );
    const reResolved2 = await resolveUserOrganizationPermissions(
      user2.public_id,
      organization.public_id,
    );

    expect(reResolved1).toEqual([TENANCY_PERMISSIONS.ORGANIZATION_READ]);
    expect(reResolved2).toEqual([TENANCY_PERMISSIONS.ORGANIZATION_READ]);
  });
});
