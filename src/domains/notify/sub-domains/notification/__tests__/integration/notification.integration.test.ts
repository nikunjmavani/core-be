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
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const PERMISSIONS = ['notify:read'];

describe('Notification Sub-Domain — Integration', () => {
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
    await seedPermissions(PERMISSIONS);
  });

  async function createAuthorizedContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: PERMISSIONS,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { organization, token };
  }

  it('returns 401 without authentication', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/notify/notifications'),
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 200 for authorized notification list', async () => {
    const { organization, token } = await createAuthorizedContext();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/notify/notifications'),
      token,
      organizationPublicId: organization.public_id,
    });
    expect(response.statusCode).toBe(200);
  });
});
