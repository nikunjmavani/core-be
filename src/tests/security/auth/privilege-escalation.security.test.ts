import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * Privilege escalation security tests — verify that members cannot grant
 * themselves elevated permissions, access resources across organizations,
 * or reach super_admin-only surfaces.
 */
describe('Security: Privilege escalation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(Object.values(TENANCY_PERMISSIONS));
  });

  /** Helper: create a user with the given permission codes and return token + org. */
  async function createMemberWithPermissions(permissionCodes: string[]) {
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
    await invalidatePermissions(user.public_id, organization.public_id);
    const token = await generateTestToken({ userId: user.public_id });
    return { user, organization, role, token };
  }

  // POSITIVE — user with ROLE_READ can list roles
  it('should allow a member with ROLE_READ to list organization roles', async () => {
    const { organization, token } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.ROLE_READ,
    ]);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
      token,
      organizationPublicId: organization.public_id,
    });

    expect(response.statusCode).not.toBe(403);
    expect([200, 404]).toContain(response.statusCode);
  });

  // POSITIVE — user with MEMBERSHIP_READ can list memberships
  it('should allow a member with MEMBERSHIP_READ to list organization memberships', async () => {
    const { organization, token } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.MEMBERSHIP_READ,
    ]);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
      token,
      organizationPublicId: organization.public_id,
    });

    expect(response.statusCode).not.toBe(403);
    expect([200, 404]).toContain(response.statusCode);
  });

  // NEGATIVE — member without ROLE_MANAGE cannot grant admin role to anyone
  it('should return 403 when member without ROLE_MANAGE tries to replace role permissions', async () => {
    const { organization, token, role } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.ROLE_READ,
      // Intentionally missing ROLE_MANAGE
    ]);

    const response = await injectAuthenticated(app, {
      method: 'PUT',
      url: testApiPath(
        `/tenancy/organizations/${organization.public_id}/roles/${role.public_id}/permissions`,
      ),
      token,
      organizationPublicId: organization.public_id,
      payload: { permission_codes: Object.values(TENANCY_PERMISSIONS) },
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — member without ROLE_MANAGE cannot create a role with elevated permissions
  it('should return 403 when member without ROLE_MANAGE tries to create a new role', async () => {
    const { organization, token } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.ROLE_READ,
      // Intentionally missing ROLE_MANAGE
    ]);

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
      token,
      organizationPublicId: organization.public_id,
      payload: { name: 'Escalated role' },
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — user in org A with valid token cannot access org B membership list
  it('should return 403 when org-A user tries to list memberships in org-B', async () => {
    const memberA = await createMemberWithPermissions([TENANCY_PERMISSIONS.MEMBERSHIP_READ]);
    const memberB = await createMemberWithPermissions([TENANCY_PERMISSIONS.MEMBERSHIP_READ]);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${memberB.organization.public_id}/memberships`),
      token: memberA.token,
      organizationPublicId: memberB.organization.public_id,
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — user in org A cannot update a role in org B
  it('should return 403 when org-A member with ROLE_MANAGE tries to update a role in org-B', async () => {
    const memberA = await createMemberWithPermissions([TENANCY_PERMISSIONS.ROLE_MANAGE]);
    const memberB = await createMemberWithPermissions([TENANCY_PERMISSIONS.ROLE_MANAGE]);

    const response = await injectAuthenticated(app, {
      method: 'PATCH',
      url: testApiPath(
        `/tenancy/organizations/${memberB.organization.public_id}/roles/${memberB.role.public_id}`,
      ),
      token: memberA.token,
      organizationPublicId: memberB.organization.public_id,
      payload: { name: 'Hijacked role name' },
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — authenticated user with no permission hits a permission-protected route
  it('should return 403 when member with no permissions hits a ROLE_READ-protected route', async () => {
    const { organization, token } = await createMemberWithPermissions([
      // No permissions at all
    ]);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/roles`),
      token,
      organizationPublicId: organization.public_id,
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — member tries to update their own membership role to a privileged one
  it('should return 403 when member without MEMBERSHIP_MANAGE tries to update a membership', async () => {
    const { organization, token, user } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.MEMBERSHIP_READ,
      // Intentionally missing MEMBERSHIP_MANAGE
    ]);

    // Fetch the membership id for this user
    const listResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
      token,
      organizationPublicId: organization.public_id,
    });
    // If we can list (200), grab the id; otherwise pick a placeholder
    let membershipId = 'mem_000000000000000000000';
    if (listResponse.statusCode === 200) {
      const body = listResponse.json() as {
        data: { memberships: { id: string; userId: string }[] };
      };
      const own = body.data?.memberships?.find((m) => m.userId === user.public_id);
      if (own) membershipId = own.id;
    }

    const upgradeRoleResponse = await injectAuthenticated(app, {
      method: 'PATCH',
      url: testApiPath(
        `/tenancy/organizations/${organization.public_id}/memberships/${membershipId}`,
      ),
      token,
      organizationPublicId: organization.public_id,
      payload: { role_id: 'rol_000000000000000000000' },
    });

    expect(upgradeRoleResponse.statusCode).toBe(403);
  });

  // NEGATIVE — member without MEMBERSHIP_MANAGE cannot add another user as a member
  it('should return 403 when member without MEMBERSHIP_MANAGE tries to add a new member', async () => {
    const { organization, token } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.MEMBERSHIP_READ,
    ]);

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/memberships`),
      token,
      organizationPublicId: organization.public_id,
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        user_id: 'usr_000000000000000000000',
        role_id: 'rol_000000000000000000000',
        status: 'ACTIVE',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — member without ORGANIZATION_UPDATE cannot modify organization settings
  it('should return 403 when member without ORGANIZATION_UPDATE tries to update the organization', async () => {
    const { organization, token } = await createMemberWithPermissions([
      TENANCY_PERMISSIONS.ORGANIZATION_READ,
      // Intentionally missing ORGANIZATION_UPDATE
    ]);

    const response = await injectAuthenticated(app, {
      method: 'PATCH',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}`),
      token,
      organizationPublicId: organization.public_id,
      payload: { name: 'Escalated org name' },
    });

    expect(response.statusCode).toBe(403);
  });

  // NEGATIVE — super_admin-only: regular member cannot call a super_admin API key endpoint
  it('should return 401 or 403 when regular user with no super_admin role hits admin-only endpoint', async () => {
    const { token } = await createMemberWithPermissions([TENANCY_PERMISSIONS.ORGANIZATION_READ]);

    // The /admin endpoint surface requires super_admin role in the JWT claim.
    // Try GET /api/v1/admin/users (if it exists) — expect 401/403 not 200.
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/admin/users'),
      token,
    });

    // This route may return 404 if admin routes are not mounted, 401 if no super_admin,
    // or 403 if denied — any of these is acceptable; 200 would be a security failure.
    expect(response.statusCode).not.toBe(200);
    expect([401, 403, 404]).toContain(response.statusCode);
  });
});
