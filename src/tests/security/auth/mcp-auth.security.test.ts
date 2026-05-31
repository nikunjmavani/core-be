import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

/**
 * MCP endpoints proxy arbitrary API calls — must require authentication and admin role.
 */
describe('Security: MCP authentication', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/mcp returns 401 without token', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/mcp'),
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/mcp returns 403 for non-admin user', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id, role: 'user' });
    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/mcp'),
      token,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /api/v1/mcp does not return 401 for super admin', async () => {
    const user = await createTestUser();
    const token = await generateSuperAdminToken(user.public_id);
    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/mcp'),
      token,
      payload: { jsonrpc: '2.0', method: 'initialize', id: 1, params: {} },
    });
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
  });
});
