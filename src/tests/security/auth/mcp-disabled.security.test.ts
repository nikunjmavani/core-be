import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import type { FastifyInstance } from 'fastify';

/**
 * When ENABLE_MCP_SERVER=false, MCP routes must not be registered (404).
 */
describe('Security: MCP disabled', () => {
  let app: FastifyInstance;
  const previousEnableMcpServer = process.env.ENABLE_MCP_SERVER;

  beforeAll(async () => {
    process.env.ENABLE_MCP_SERVER = 'false';
    resetEnvCacheForTests();
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
    if (previousEnableMcpServer === undefined) {
      delete process.env.ENABLE_MCP_SERVER;
    } else {
      process.env.ENABLE_MCP_SERVER = previousEnableMcpServer;
    }
    resetEnvCacheForTests();
  });

  it('POST /api/v1/mcp returns 404 when MCP server is disabled', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/mcp'),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/v1/mcp returns 404 when MCP server is disabled', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/mcp'),
    });
    expect(response.statusCode).toBe(404);
  });
});
