import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
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
import type { FastifyInstance } from 'fastify';

const CALLER_PERMISSIONS = ['role:read', 'role:manage', 'membership:read', 'membership:manage'];

/**
 * Happy paths for the tenancy role / membership detail routes — the declared
 * success statuses (200 GET/PATCH, 204 DELETE) observed with a caller holding
 * the read+manage permissions.
 */
describe('Tenancy role and membership detail — happy paths', () => {
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

  async function createAuthorizedContext() {
    await seedPermissions(CALLER_PERMISSIONS);
    const caller = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: caller.id });
    const callerRole = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: CALLER_PERMISSIONS,
      createdByUserId: caller.id,
    });
    await createMembership({
      userId: caller.id,
      organizationId: organization.id,
      roleId: callerRole.id,
    });
    // Flat tenancy routes resolve the organization from the JWT `org` claim.
    const token = await generateTestToken({
      userId: caller.public_id,
      organizationPublicId: organization.public_id,
    });
    return { caller, organization, callerRole, token };
  }

  it('GET, PATCH, and DELETE a role detail', async () => {
    const { caller, organization, token } = await createAuthorizedContext();
    const targetRole = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [],
      createdByUserId: caller.id,
      name: 'Detail Target Role',
    });
    const basePath = `/tenancy/organization/roles/${targetRole.public_id}`;

    const get = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(basePath),
      token,
    });
    expect(get.statusCode, get.body).toBe(200);

    const patch = await injectAuthenticatedOrganizationMutation(app, {
      method: 'PATCH',
      url: testApiPath(basePath),
      token,
      payload: { name: 'Detail Target Role Updated' },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    const remove = await injectAuthenticatedOrganizationMutation(app, {
      method: 'DELETE',
      url: testApiPath(basePath),
      token,
    });
    expect(remove.statusCode, remove.body).toBe(204);
  });

  it('GET, PATCH, and DELETE a membership detail', async () => {
    const { caller, organization, token } = await createAuthorizedContext();
    const member = await createTestUser({ email: 'detail-member@test.com' });
    const memberRole = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [],
      createdByUserId: caller.id,
      name: 'Member Role',
    });
    const membership = await createMembership({
      userId: member.id,
      organizationId: organization.id,
      roleId: memberRole.id,
    });
    const basePath = `/tenancy/organization/memberships/${membership.public_id}`;

    const get = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(basePath),
      token,
    });
    expect(get.statusCode, get.body).toBe(200);

    const patch = await injectAuthenticatedOrganizationMutation(app, {
      method: 'PATCH',
      url: testApiPath(basePath),
      token,
      payload: { status: 'ACTIVE' },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    const remove = await injectAuthenticatedOrganizationMutation(app, {
      method: 'DELETE',
      url: testApiPath(basePath),
      token,
    });
    expect(remove.statusCode, remove.body).toBe(204);
  });
});
