import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { database } from '@/infrastructure/database/connection.js';
import { auth_methods } from '@/domains/auth/sub-domains/auth-method/auth-method.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
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

  describe('GET /api/v1/auth/oauth/:provider', () => {
    it('returns the provider authorize redirect URL (200)', async () => {
      // setup.ts pins fake OAuth client credentials, so the authorize URL is
      // built deterministically (pure string work, no outbound call).
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/oauth/google'),
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = (response.json() as { data: { redirect_url?: string } }).data;
      expect(body.redirect_url).toContain('accounts.google.com');
    });
  });

  describe('self-service auth-method management — happy paths', () => {
    it('POST then DELETE /auth/me/auth-methods round-trips a MAGIC_LINK method', async () => {
      const { user, password } = await createTestUserWithPassword();
      const token = await generateTestToken({ userId: user.public_id });

      // Auth-method mutations require a recent step-up (password re-proof).
      const stepUp = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/step-up'),
        token,
        payload: { password },
      });
      expect(stepUp.statusCode, stepUp.body).toBe(200);

      // The last-login-capable guard counts auth_methods rows; give the user a
      // PASSWORD method row so removing the magic-link is not removing the last one.
      await database.insert(auth_methods).values({
        public_id: generatePublicId(),
        user_id: user.id,
        method_type: 'PASSWORD',
        is_primary: true,
        verified_at: new Date(),
      });

      // MAGIC_LINK is the only type this endpoint may create (route-#3).
      const create = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/auth-methods'),
        token,
        payload: { method_type: 'MAGIC_LINK' },
      });
      expect(create.statusCode, create.body).toBe(201);
      const created = (create.json() as { data: { id?: string; public_id?: string } }).data;
      const methodPublicId = created.id ?? created.public_id;
      expect(methodPublicId).toBeTypeOf('string');

      // The user keeps the password method, so the last-login-capable
      // credential guard does not block this delete.
      const remove = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/auth-methods/${methodPublicId}`),
        token,
      });
      expect(remove.statusCode, remove.body).toBe(204);
    });
  });
});
