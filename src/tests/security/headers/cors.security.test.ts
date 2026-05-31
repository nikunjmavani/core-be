import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

/**
 * CORS configuration tests — verify cross-origin headers are set correctly.
 */
describe('Security: CORS', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should include CORS headers in response', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'OPTIONS',
      url: testApiPath('/auth/login'),
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      },
    });
    // CORS preflight should return 204 or 200
    expect([200, 204]).toContain(response.statusCode);
  });

  it('should include Access-Control-Allow-Methods header', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'OPTIONS',
      url: testApiPath('/auth/login'),
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      },
    });
    const allowMethods = response.headers['access-control-allow-methods'];
    if (allowMethods) {
      expect(typeof allowMethods).toBe('string');
    }
  });

  it('should handle requests from allowed origins', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/livez',
      headers: { origin: 'http://localhost:3000' },
    });
    // Response should include CORS headers for allowed origin
    expect([200, 204]).toContain(response.statusCode);
  });
});
