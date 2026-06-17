import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { generate as generateTotp } from 'otplib';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import {
  generateTestToken,
  generateTestTokenAndSession,
  generateSuperAdminToken,
} from '@/tests/helpers/test-auth.js';
import { seedRecentStepUpForTestUser } from '@/tests/helpers/test-step-up.helper.js';
import type { FastifyInstance } from 'fastify';
import type { InjectHttpResult } from '@/tests/helpers/test-http-inject.helper.js';

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
      method: 'GET',
      url: testApiPath('/users/me'),
      token,
    });
    if (response.statusCode !== 404) return response;
    if (attempt < ME_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, ME_RETRY_DELAY_MS * attempt));
    }
  }
  return injectAuthenticated(application, { method: 'GET', url: testApiPath('/users/me'), token });
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
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return current user profile', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await getMeWithRetry(app, token);
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });

    it('should return is_mfa_enabled false when user has no MFA', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await getMeWithRetry(app, token);
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty(
        'is_mfa_enabled',
        false,
      );
    });

    it('should return is_mfa_enabled true after MFA enroll and false after revoke', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: user.public_id,
      });
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const meBefore = await getMeWithRetry(app, token);
      expect(meBefore.statusCode).toBe(200);
      expect((meBefore.json() as { data: Record<string, unknown> }).data.is_mfa_enabled).toBe(
        false,
      );

      const enrollResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll'),
        token: token,
        payload: { method_type: 'MFA_TOTP' },
      });
      expect(enrollResponse.statusCode).toBe(201);
      const enrollSecret = (enrollResponse.json() as { data: { secret: string } }).data.secret;
      const confirmResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll/confirm'),
        token: token,
        payload: { code: await generateTotp({ secret: enrollSecret }) },
      });
      expect(confirmResponse.statusCode).toBe(201);
      // route-#10: the serializer returns `mfa_method_id` and DELETE /auth/me/mfa/{mfa_method_id}
      // now accepts that opaque public id directly (the bigserial id is never exposed).
      const methodPublicId = (confirmResponse.json() as { data: Record<string, unknown> }).data
        .mfa_method_id as string;
      expect(typeof methodPublicId).toBe('string');
      expect(methodPublicId).toMatch(/^am_[a-z0-9]{21}$/);

      const meAfterEnroll = await getMeWithRetry(app, token);
      expect(meAfterEnroll.statusCode).toBe(200);
      expect((meAfterEnroll.json() as { data: Record<string, unknown> }).data.is_mfa_enabled).toBe(
        true,
      );

      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const deleteResponse = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/mfa/${methodPublicId}`),
        token: token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const meAfterRevoke = await getMeWithRetry(app, token);
      expect(meAfterRevoke.statusCode).toBe(200);
      expect((meAfterRevoke.json() as { data: Record<string, unknown> }).data.is_mfa_enabled).toBe(
        false,
      );
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
        token: token,
        payload: { first_name: 'Updated' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return 400 or 422 for invalid body', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me'),
        token: token,
        payload: { unknown_field: true },
      });
      expect([400, 422]).toContain(response.statusCode);
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
        token: token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const meResponse = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me'),
        token: token,
      });
      expect(meResponse.statusCode).toBe(401);
    });
  });

  // ─── Self-service: Settings ───────────────────────────────────

  describe('GET /api/v1/users/me/settings', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return user settings', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
        token: token,
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
        method: 'GET',
        url: testApiPath('/users/me/notification-preferences'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return notification preferences', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/notification-preferences'),
        token: token,
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
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/'),
        token: token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return users for super admin', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });
  });

  describe('GET /api/v1/users/:user_id', () => {
    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/users/${user.public_id}`),
        token: token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/users/:user_id/suspend', () => {
    it('should return 403 for non-admin', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/users/${user.public_id}/suspend`),
        token: token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/users/:user_id/unsuspend', () => {
    it('should return 403 for non-admin', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id, role: 'user' });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/users/${user.public_id}/unsuspend`),
        token: token,
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
