import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Method Sub-Domain — Integration', () => {
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

  describe('POST /api/v1/auth/login', () => {
    it('should return 400 for missing credentials', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/login'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/login'),
        payload: {
          email: 'nonexistent@test.com',
          password: 'WrongPassword123!',
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 200 for valid credentials', async () => {
      const { user, password } = await createTestUserWithPassword();
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/login'),
        payload: { email: user.email, password },
      });
      expect(response.statusCode).toBe(200);
      expect(
        (response.json() as { data?: { access_token?: string } }).data?.access_token,
      ).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/magic-link/send', () => {
    it('should accept magic link send request', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/send'),
        payload: { email: 'magic-link-integration@test.com' },
      });
      expect([200, 202, 204]).toContain(response.statusCode);
    });
  });
});
