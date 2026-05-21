import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';

describe('Plan Sub-Domain — Integration', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    const user = await createTestUser();
    token = await generateTestToken({ userId: user.public_id });
  });

  describe('GET /api/v1/billing/plans', () => {
    it('returns 200 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
      });
      expect(response.statusCode).toBe(200);
    });

    it('returns 200 for authenticated request', async () => {
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });

    it('returns cache headers and 304 on repeat fetch with If-None-Match', async () => {
      const firstResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
        token,
      });
      expect(firstResponse.statusCode).toBe(200);
      const etag = firstResponse.headers.etag;
      expect(etag).toBeDefined();
      expect(firstResponse.headers['cache-control']).toContain('max-age=300');

      const secondResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
        token,
        headers: { 'if-none-match': String(etag) },
      });
      expect(secondResponse.statusCode).toBe(304);
      expect(secondResponse.body).toBe('');
    });
  });
});
