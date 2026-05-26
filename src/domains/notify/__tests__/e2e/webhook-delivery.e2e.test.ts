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
import type { FastifyInstance } from 'fastify';

const WEBHOOK_PERMISSIONS = ['webhook:read', 'webhook:manage'];

describe('Notify e2e: webhook delivery', () => {
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
    await seedPermissions(WEBHOOK_PERMISSIONS);
  });

  it('creates webhook and lists webhooks', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: WEBHOOK_PERMISSIONS,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });

    const createResponse = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/notify/organizations/${organization.public_id}/webhooks`),
      token,
      organizationPublicId: organization.public_id,
      payload: {
        url: 'https://example.com/webhook',
        events: ['subscription.created'],
      },
    });
    expect([200, 201]).toContain(createResponse.statusCode);

    const listResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/notify/organizations/${organization.public_id}/webhooks`),
      token,
      organizationPublicId: organization.public_id,
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json() as {
      meta?: { pagination?: { has_more?: boolean; next?: string | null } };
    };
    expect(listBody.meta?.pagination).toMatchObject({ has_more: false, next: null });
  });
});
