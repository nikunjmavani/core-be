import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
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
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import type { FastifyInstance } from 'fastify';

const ROLE_FLOW_PERMISSIONS = [
  TENANCY_PERMISSIONS.ROLE_READ,
  TENANCY_PERMISSIONS.ROLE_MANAGE,
  TENANCY_PERMISSIONS.MEMBERSHIP_READ,
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
];

describe('Tenancy e2e: member role permission', () => {
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
    await seedPermissions(ROLE_FLOW_PERMISSIONS);
  });

  it('creates role and lists organization member roles', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const ownerRole = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ROLE_FLOW_PERMISSIONS,
    });
    await createMembership({
      userId: owner.id,
      organizationId: organization.id,
      roleId: ownerRole.id,
    });
    const token = await generateTestToken({
      userId: owner.public_id,
      organizationPublicId: organization.public_id,
    });

    const createRoleResponse = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organization/roles'),
      token,
      payload: { name: 'E2E Custom Role', description: 'e2e' },
    });
    expect([201]).toContain(createRoleResponse.statusCode);

    const listRolesResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/tenancy/organization/roles'),
      token,
    });
    expect(listRolesResponse.statusCode).toBe(200);
  });
});
