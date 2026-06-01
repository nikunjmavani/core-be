import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Security: Header injection', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should not reflect CRLF injection in custom headers into response', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/livez',
      headers: { 'X-Custom-Test': 'value\r\nX-Injected: true' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-injected']).toBeUndefined();
  });

  it('should reject newline injection in Origin header on refresh', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/refresh'),
      headers: { Origin: 'https://evil.com\r\nX-Injected: true' },
      payload: {},
    });

    expect([400, 401, 403]).toContain(response.statusCode);
    expect(response.headers['x-injected']).toBeUndefined();
  });
});
