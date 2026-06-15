import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Audit Domain — Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  describe('GET /api/v1/audit/logs', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return logs for super admin', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown };
      expect(body.data).toBeDefined();
    });

    it('route-#6: downgrades a non-allowlisted admin-role token (no blind trust)', async () => {
      // The global ADMIN tier is never minted (roles derive only from GLOBAL_ADMIN_EMAILS →
      // super_admin / user), so a bare `admin` claim is stale/forged: the auth middleware
      // re-derives it against live state and a non-allowlisted user is downgraded to USER → 403.
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'admin' });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should accept cursor pagination query parameters', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs'),
        token,
        query: { limit: '5' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        meta?: { pagination?: { per_page: number; has_more: boolean } };
      };
      expect(body.meta?.pagination).toBeDefined();
      expect(body.meta?.pagination?.per_page).toBeLessThanOrEqual(5);
      expect(typeof body.meta?.pagination?.has_more).toBe('boolean');
    });
  });
});
