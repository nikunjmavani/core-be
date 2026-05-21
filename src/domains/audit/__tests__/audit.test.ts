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
      const response = await injectUnauthenticated(app, { url: '/api/v1/audit/logs' });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        url: '/api/v1/audit/logs',
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return logs for super admin', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        url: '/api/v1/audit/logs',
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });

    it('should return logs for admin role', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'admin' });
      const response = await injectAuthenticated(app, {
        url: '/api/v1/audit/logs',
        token,
      });
      expect(response.statusCode).toBe(200);
    });

    it('should accept pagination query parameters', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        url: '/api/v1/audit/logs',
        token,
        query: { page: '1', limit: '5' },
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
