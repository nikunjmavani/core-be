import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';

/**
 * MCP streamable-HTTP POST happy path — the transport runs with
 * `enableJsonResponse: true`, so a JSON-RPC `initialize` request returns a
 * single JSON response (200) instead of opening an SSE stream. The GET leg
 * (server→client SSE stream on a hijacked reply) is intentionally
 * coverage-exempt — see ROUTE_SUCCESS_COVERAGE_EXEMPT_KEYS.
 */
describe('MCP route — POST initialize happy path', () => {
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

  it('POST /api/v1/mcp answers a JSON-RPC initialize with 200 for a global admin', async () => {
    // SUPER_ADMIN is re-derived per request from GLOBAL_ADMIN_EMAILS (sec-A6).
    const admin = await createTestUser({ email: 'ops@example.com', isEmailVerified: true });
    const token = await generateTestToken({ userId: admin.public_id, role: 'super_admin' });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: '/api/v1/mcp',
      token,
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'route-coverage-test', version: '1.0.0' },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = JSON.parse(response.body) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBeTypeOf('string');
  });
});
