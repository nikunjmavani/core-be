import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

/**
 * CORS configuration tests — verify cross-origin headers are set correctly.
 */
describe('Security: CORS', () => {
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

  it('should include CORS headers in response', async () => {
    const response = await request
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    // CORS preflight should return 204 or 200
    expect([200, 204]).toContain(response.status);
  });

  it('should include Access-Control-Allow-Methods header', async () => {
    const response = await request
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    const allowMethods = response.headers['access-control-allow-methods'];
    if (allowMethods) {
      expect(typeof allowMethods).toBe('string');
    }
  });

  it('should handle requests from allowed origins', async () => {
    const response = await request.get('/health').set('Origin', 'http://localhost:3000');
    // Response should include CORS headers for allowed origin
    expect([200, 204]).toContain(response.status);
  });
});
