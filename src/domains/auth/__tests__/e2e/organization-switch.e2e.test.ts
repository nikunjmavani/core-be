import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestTokenAndSession } from '@/tests/helpers/test-auth.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { seedPermissions } from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { provisionPersonalOrganization } from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';

describe('Auth e2e: organization switch', () => {
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
    await seedPermissions(Object.values(TENANCY_PERMISSIONS));
  });

  it('switch-to-personal re-mints the token for the personal organization (201)', async () => {
    const user = await createTestUser();
    await provisionPersonalOrganization(user.id);
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-personal'),
      token,
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as { data: { access_token: string } }).data.access_token).toBeDefined();
  });

  it('switch-to-personal returns 404 when the user has no personal organization', async () => {
    const user = await createTestUser();
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-personal'),
      token,
    });

    expect(response.statusCode).toBe(404);
  });

  it('switch-to-organization re-mints for an org the caller is a member of (201)', async () => {
    const user = await createTestUser();
    const { organization } = await provisionPersonalOrganization(user.id);
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-organization'),
      token,
      payload: { organization_id: organization.public_id },
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as { data: { access_token: string } }).data.access_token).toBeDefined();
  });

  it('switch-to-organization returns 403 for an org the caller does not belong to', async () => {
    const member = await createTestUser();
    const stranger = await createTestUser();
    const { organization } = await provisionPersonalOrganization(member.id);
    const { token } = await generateTestTokenAndSession({ userId: stranger.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-organization'),
      token,
      payload: { organization_id: organization.public_id },
    });

    expect(response.statusCode).toBe(403);
  });

  it('switch-to-organization returns 400 when organization_id is missing', async () => {
    const user = await createTestUser();
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-organization'),
      token,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
