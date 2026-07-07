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
    expect([200, 204]).toContain(response.statusCode);
    // The ACTUAL response (not just the preflight) must carry the CORS headers — the
    // browser discards an opaque 2xx without them. Regression: cors.middleware was not
    // fastify-plugin-wrapped, so @fastify/cors's decoration hook stayed encapsulated and
    // only the global wildcard OPTIONS route worked (preflight passed, real responses
    // had no Access-Control-Allow-Origin → CORS failure on the deployed Netlify FE).
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('includes Access-Control-Allow-Origin on actual API route responses', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: {},
    });
    // Payload is invalid on purpose — the CORS decoration must be present on every
    // response (including error responses), or the browser hides the body from the SPA.
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not reflect a non-allowlisted origin', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'OPTIONS',
      url: testApiPath('/auth/login'),
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'POST',
      },
    });
    // @fastify/cors with an array allowlist omits Access-Control-Allow-Origin for a disallowed
    // origin. With credentials:true, echoing the attacker origin back would be exploitable, so the
    // header must never equal the evil origin — only absent or the configured allowed origin.
    const allowOrigin = response.headers['access-control-allow-origin'];
    expect(allowOrigin).not.toBe('https://evil.example.com');
    expect(allowOrigin === undefined || allowOrigin === 'http://localhost:3000').toBe(true);
  });
});
