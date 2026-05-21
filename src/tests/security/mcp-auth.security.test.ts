import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';

/**
 * MCP endpoints proxy arbitrary API calls — must require authentication and admin role.
 */
describe('Security: MCP authentication', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/mcp returns 401 without token', async () => {
    const response = await request.post('/api/v1/mcp').send({});
    expect(response.status).toBe(401);
  });

  it('POST /api/v1/mcp returns 403 for non-admin user', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id, role: 'user' });
    const response = await request
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(response.status).toBe(403);
  });

  it('POST /api/v1/mcp does not return 401 for super admin', async () => {
    const user = await createTestUser();
    const token = await generateSuperAdminToken(user.public_id);
    const response = await request
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} });
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});
