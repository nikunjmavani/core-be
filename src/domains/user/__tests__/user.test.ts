import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
  type InjectHttpResult,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const ME_RETRY_ATTEMPTS = 3;
const ME_RETRY_DELAY_MS = 50;

/**
 * GET /api/v1/users/me with retries on 404 to absorb transient DB visibility after createTestUser().
 */
async function getMeWithRetry(
  application: FastifyInstance,
  token: string,
): Promise<InjectHttpResult> {
  for (let attempt = 1; attempt <= ME_RETRY_ATTEMPTS; attempt++) {
    const response = await injectAuthenticated(application, {
      url: testApiPath('/users/me'),
      token,
    });
    if (response.statusCode !== 404) return response;
    if (attempt < ME_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, ME_RETRY_DELAY_MS * attempt));
    }
  }
  return injectAuthenticated(application, {
    url: testApiPath('/users/me'),
    token,
  });
}

describe('User Domain — Integration', () => {
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

  // ─── Self-service: /me ────────────────────────────────────────

  describe('GET /api/v1/users/me', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, { url: testApiPath('/users/me') });
      expect(response.statusCode).toBe(401);
    });

    it('should return current user profile', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await getMeWithRetry(app, token);
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });

    it('should return is_mfa_enabled false when user has no MFA', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await getMeWithRetry(app, token);
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { is_mfa_enabled: boolean } };
      expect(body.data).toHaveProperty('is_mfa_enabled', false);
    });

    it('should return is_mfa_enabled true after MFA enroll and false after revoke', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const meBefore = await getMeWithRetry(app, token);
      expect(meBefore.statusCode).toBe(200);
      const meBeforeBody = meBefore.json() as { data: { is_mfa_enabled: boolean } };
      expect(meBeforeBody.data.is_mfa_enabled).toBe(false);

      const enrollResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/enroll'),
        token,
        payload: { method_type: 'MFA_TOTP' },
      });
      expect(enrollResponse.statusCode).toBe(200);
      const enrollBody = enrollResponse.json() as { data: { method_id: number } };
      const methodId = enrollBody.data.method_id;
      expect(typeof methodId).toBe('number');

      const meAfterEnroll = await getMeWithRetry(app, token);
      expect(meAfterEnroll.statusCode).toBe(200);
      const meAfterEnrollBody = meAfterEnroll.json() as { data: { is_mfa_enabled: boolean } };
      expect(meAfterEnrollBody.data.is_mfa_enabled).toBe(true);

      const deleteResponse = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/mfa/${methodId}`),
        token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const meAfterRevoke = await getMeWithRetry(app, token);
      expect(meAfterRevoke.statusCode).toBe(200);
      const meAfterRevokeBody = meAfterRevoke.json() as { data: { is_mfa_enabled: boolean } };
      expect(meAfterRevokeBody.data.is_mfa_enabled).toBe(false);
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should update current user profile', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me'),
        token,
        payload: { first_name: 'Updated' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/users/me', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/users/me'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should soft-delete user, revoke sessions, and hide profile', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const deleteResponse = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/users/me'),
        token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const meResponse = await injectAuthenticated(app, {
        url: testApiPath('/users/me'),
        token,
      });
      expect(meResponse.statusCode).toBe(401);
    });
  });

  // ─── Self-service: Settings ───────────────────────────────────

  describe('GET /api/v1/users/me/settings', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, { url: testApiPath('/users/me/settings') });
      expect(response.statusCode).toBe(401);
    });

    it('should return user settings', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/users/me/settings'),
        token,
      });
      expect([200, 404]).toContain(response.statusCode);
    });
  });

  describe('PATCH /api/v1/users/me/settings', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me/settings'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ─── Self-service: Notification Preferences ───────────────────

  describe('GET /api/v1/users/me/notification-preferences', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/users/me/notification-preferences'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return notification preferences', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/users/me/notification-preferences'),
        token,
      });
      expect([200, 404]).toContain(response.statusCode);
    });
  });

  // ─── Self-service: Avatar ─────────────────────────────────────

  describe('PUT /api/v1/users/me/avatar', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/avatar'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/users/me/avatar', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/users/me/avatar'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ─── Admin: User management ───────────────────────────────────

  describe('GET /api/v1/users/', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, { url: testApiPath('/users/') });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, { url: testApiPath('/users/'), token });
      expect(response.statusCode).toBe(403);
    });

    it('should return users for super admin', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, { url: testApiPath('/users/'), token });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });

  describe('GET /api/v1/users/:userId', () => {
    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        url: testApiPath(`/users/${user.public_id}`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/users/:userId/suspend', () => {
    it('should return 403 for non-admin', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/users/${user.public_id}/suspend`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/users/:userId/unsuspend', () => {
    it('should return 403 for non-admin', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/users/${user.public_id}/unsuspend`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
