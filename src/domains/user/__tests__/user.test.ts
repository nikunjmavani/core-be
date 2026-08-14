import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { generate as generateTotp } from 'otplib';
import { eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
  type InjectHttpResult,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { seedAllPermissions } from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import {
  generateTestToken,
  generateTestTokenAndSession,
  generateSuperAdminToken,
} from '@/tests/helpers/test-auth.js';
import { seedRecentStepUpForTestUser } from '@/tests/helpers/test-step-up.helper.js';
import { database } from '@/infrastructure/database/connection.js';
import { users } from '@/domains/user/user.schema.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const ME_RETRY_ATTEMPTS = 3;
const ME_RETRY_DELAY_MS = 50;
/**
 * Wall-clock gap between the two onboarding-complete calls. `markOnboardingComplete` stamps
 * `now()`, so without a measurable gap a re-stamped row could coincidentally equal the original
 * and the idempotency assertion would pass for the wrong reason.
 */
const ONBOARDING_REPEAT_DELAY_MS = 25;

/**
 * Reads the raw `onboarding_completed_at` stamp. The API deliberately projects it to the
 * `onboarding_completed` boolean, so asserting that a repeat call did not MOVE the timestamp
 * needs a direct read.
 */
async function readOnboardingCompletedAt(userPublicId: string): Promise<Date | null> {
  const [row] = await database
    .select({ onboarding_completed_at: users.onboarding_completed_at })
    .from(users)
    .where(eq(users.public_id, userPublicId))
    .limit(1);
  return row?.onboarding_completed_at ?? null;
}

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
    // GET /users/me self-heals a missing personal org (provisions on read when personal is
    // enabled); provisioning grants the owner role every permission code, so the full catalog
    // must exist or the role_permissions → permissions FK fails. Seed it so the self-heal
    // succeeds and personal_organization_id is reliably non-null (mirrors the tenancy suites).
    await seedAllPermissions();
  });

  // ─── Self-service: /me ────────────────────────────────────────

  describe('GET /api/v1/users/me', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/users/me'),
      });
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

    it('exposes personal_organization_id (self-heal provisions one on demand)', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await getMeWithRetry(app, token);
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          personal_organization_id: string | null;
        };
      };
      // Self-heal: a bare createTestUser has no personal org, but with personal enabled
      // getMe provisions one on demand so personal_organization_id is reliably non-null
      // (a user can never dead-end onboarding for lack of a personal workspace).
      expect(body.data.personal_organization_id).toMatch(/^org_[a-z0-9]{21}$/);
    });

    it('should return is_mfa_enabled true after MFA enroll and false after revoke', async () => {
      // MFA enrollment requires a verified email (account pre-hijacking guard).
      const user = await createTestUser({ isEmailVerified: true });
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: user.public_id,
      });
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const meBefore = await getMeWithRetry(app, token);
      expect(meBefore.statusCode).toBe(200);
      const meBeforeBody = meBefore.json() as {
        data: { is_mfa_enabled: boolean };
      };
      expect(meBeforeBody.data.is_mfa_enabled).toBe(false);

      const enrollResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll'),
        token,
        payload: { method_type: 'MFA_TOTP' },
      });
      expect(enrollResponse.statusCode).toBe(201);
      const enrollBody = enrollResponse.json() as { data: { secret: string } };
      const confirmResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll/confirm'),
        token,
        payload: {
          code: await generateTotp({ secret: enrollBody.data.secret }),
        },
      });
      expect(confirmResponse.statusCode).toBe(201);
      // route-#10: the serializer returns `mfa_method_id` and DELETE /auth/me/mfa/{mfa_method_id}
      // now accepts that opaque public id directly (the bigserial id is never exposed).
      const confirmBody = confirmResponse.json() as {
        data: { mfa_method_id: string };
      };
      const methodPublicId = confirmBody.data.mfa_method_id;
      expect(typeof methodPublicId).toBe('string');
      expect(methodPublicId).toMatch(/^am_[a-z0-9]{21}$/);

      const meAfterEnroll = await getMeWithRetry(app, token);
      expect(meAfterEnroll.statusCode).toBe(200);
      const meAfterEnrollBody = meAfterEnroll.json() as {
        data: { is_mfa_enabled: boolean };
      };
      expect(meAfterEnrollBody.data.is_mfa_enabled).toBe(true);

      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const deleteResponse = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/mfa/${methodPublicId}`),
        token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const meAfterRevoke = await getMeWithRetry(app, token);
      expect(meAfterRevoke.statusCode).toBe(200);
      const meAfterRevokeBody = meAfterRevoke.json() as {
        data: { is_mfa_enabled: boolean };
      };
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

    it('should update name and job_title together (onboarding profile)', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me'),
        token,
        payload: { first_name: 'NIK', last_name: 'PATEL', job_title: 'CEO' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          first_name: string | null;
          last_name: string | null;
          job_title: string | null;
        };
      };
      expect(body.data).toMatchObject({
        first_name: 'NIK',
        last_name: 'PATEL',
        job_title: 'CEO',
      });
    });
  });

  /**
   * The frontend calls this at the end of every signup, and post-login routing reads the
   * resulting flag to choose between the onboarding wizard and the dashboard — a regression
   * here traps every new user in a loop, so the route is pinned end-to-end rather than only
   * at the repository layer.
   */
  describe('POST /api/v1/users/me/onboarding/complete', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should stamp onboarding and report onboarding_completed on GET /users/me', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const before = await getMeWithRetry(app, token);
      expect(before.statusCode).toBe(200);
      expect(
        (before.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(false);

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
        token,
      });
      expect(response.statusCode).toBe(201);
      expect(
        (response.json() as { data: { id: string; onboarding_completed: boolean } }).data,
      ).toMatchObject({ id: user.public_id, onboarding_completed: true });

      // Post-login routing reads the flag back from GET /users/me, not from this POST's echo —
      // assert the persisted read path the frontend actually depends on.
      const after = await getMeWithRetry(app, token);
      expect(after.statusCode).toBe(200);
      expect(
        (after.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(true);
      expect(await readOnboardingCompletedAt(user.public_id)).not.toBeNull();
    });

    it('should be a no-op on repeat: still 201, original timestamp preserved', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const first = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
        token,
      });
      expect(first.statusCode).toBe(201);
      const firstStamp = await readOnboardingCompletedAt(user.public_id);
      expect(firstStamp).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, ONBOARDING_REPEAT_DELAY_MS));

      const second = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
        token,
      });
      expect(second.statusCode).toBe(201);
      expect(
        (second.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(true);
      // The repository's `IS NULL` guard must hold through the route: a double-submit or retry
      // must not move the user's original completion time forward.
      expect(await readOnboardingCompletedAt(user.public_id)).toEqual(firstStamp);
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
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/users/me/settings'),
      });
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
      const response = await injectUnauthenticated(app, {
        url: testApiPath('/users/'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({
        userId: user.public_id,
        role: 'user',
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath('/users/'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return users for super admin', async () => {
      const user = await createTestUser();
      const token = await generateSuperAdminToken(user.public_id);
      const response = await injectAuthenticated(app, {
        url: testApiPath('/users/'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown };
      expect(body.data).toBeDefined();
    });
  });

  describe('GET /api/v1/users/:user_id', () => {
    it('should return 403 for non-admin user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({
        userId: user.public_id,
        role: 'user',
      });
      const response = await injectAuthenticated(app, {
        url: testApiPath(`/users/${user.public_id}`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/users/:user_id/suspend', () => {
    it('should return 403 for non-admin', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({
        userId: user.public_id,
        role: 'user',
      });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/users/${user.public_id}/suspend`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/users/:user_id/unsuspend', () => {
    it('should return 403 for non-admin', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({
        userId: user.public_id,
        role: 'user',
      });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/users/${user.public_id}/unsuspend`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
