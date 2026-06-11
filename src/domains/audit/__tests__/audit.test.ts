import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('Audit Domain — Integration', () => {
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

  // ─── Audit Logs ───────────────────────────────────────────────

  describe('GET /api/v1/audit/logs', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, { url: testApiPath('/audit/logs') });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/audit/logs'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return logs for super admin', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        url: testApiPath('/audit/logs'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });

    it('route-#6: downgrades a non-allowlisted admin-role token (no blind trust)', async () => {
      // The global ADMIN tier is never minted (roles come only from GLOBAL_ADMIN_EMAILS →
      // super_admin / user). A bare `admin` claim is therefore a stale/forged claim: the auth
      // middleware now re-derives it against live state, so a non-allowlisted user is downgraded
      // to USER and denied the admin-only audit route.
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'admin' });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/audit/logs'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should accept cursor pagination query parameters', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        url: testApiPath('/audit/logs'),
        token,
        query: { limit: '5' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        meta?: { pagination?: { per_page?: number } };
      };
      expect(body.meta?.pagination).toBeDefined();
      expect(body.meta?.pagination?.per_page).toBe(5);
    });
  });
});
