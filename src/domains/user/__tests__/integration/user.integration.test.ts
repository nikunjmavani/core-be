import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';
import type { InjectHttpResult } from '@/tests/helpers/test-http-inject.helper.js';

const ME_RETRY_ATTEMPTS = 3;
const ME_RETRY_DELAY_MS = 50;

/** PNG file signature so the upload confirm step's magic-byte verification passes. */
const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const FAKE_CONTENT_LENGTH = 1024;

// `PUT /users/me/avatar` needs object storage to answer before it will return its declared 200.
// Stub at the ObjectStoragePort seam (the same seam `storage-routes-happy` uses) so the avatar
// contract is proven inside the user domain rather than only in a platform-wide file.
vi.mock('@/infrastructure/storage/s3-adapter.js', () => {
  const fakeObjectStorage = {
    createPresignedUploadUrl: async () => 'https://fake-s3.local/presigned-put',
    createPresignedUploadPost: async () => ({
      url: 'https://fake-s3.local/upload',
      fields: { key: 'fake-policy-key' },
    }),
    verifyUploadedObject: async (
      _key: string,
      expected: { contentType: string; contentLength: number },
    ) => ({
      contentType: expected.contentType,
      contentLength: expected.contentLength,
      eTag: '"fake-etag"',
    }),
    headObject: async () => ({ contentType: 'image/png', contentLength: FAKE_CONTENT_LENGTH }),
    deleteObject: async () => true,
    putObject: async () => {},
    copyObject: async () => {},
    getObject: async () => ({ body: PNG_MAGIC_BYTES, contentType: 'image/png' }),
    getObjectFirstBytes: async () => ({
      body: PNG_MAGIC_BYTES,
      contentType: 'image/png',
      eTag: '"fake-etag"',
    }),
    getObjectUrl: (key: string) => `https://fake-s3.local/${key}`,
    createPresignedDownloadUrl: async () => 'https://fake-s3.local/presigned-get',
  };
  return {
    getDefaultS3ObjectStorageAdapter: () => fakeObjectStorage,
    S3ObjectStorageAdapter: class {},
  };
});

/** Create + confirm an avatar upload, returning the storage key the attach route expects. */
async function createConfirmedAvatarUpload(
  application: FastifyInstance,
  token: string,
): Promise<string> {
  const create = await injectAuthenticated(application, {
    method: 'POST',
    url: testApiPath('/uploads'),
    token,
    payload: {
      purpose: 'avatar',
      for: 'user',
      content_type: 'image/png',
      file_name: 'avatar.png',
      file_size: FAKE_CONTENT_LENGTH,
    },
  });
  expect(create.statusCode, create.body).toBe(201);
  const created = (create.json() as { data: { id: string; key: string } }).data;

  const confirm = await injectAuthenticated(application, {
    method: 'POST',
    url: testApiPath(`/uploads/${created.id}/confirm`),
    token,
  });
  expect(confirm.statusCode, confirm.body).toBe(201);
  return created.key;
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

  describe('POST /api/v1/users/me/onboarding/complete', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 201 and flip onboarding_completed on the self profile', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const before = await getMeWithRetry(app, token);
      expect(before.statusCode, before.body).toBe(200);
      expect(
        (before.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(false);

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
        token,
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(
        (response.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(true);

      const after = await getMeWithRetry(app, token);
      expect(after.statusCode, after.body).toBe(200);
      expect(
        (after.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(true);
    });

    it('should be idempotent — a second call still returns 201 and keeps the original stamp', async () => {
      // The repository stamps only while `onboarding_completed_at IS NULL`, so a wizard that
      // double-submits must not move the timestamp or start erroring.
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const first = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
        token,
      });
      expect(first.statusCode, first.body).toBe(201);

      const second = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/users/me/onboarding/complete'),
        token,
      });
      expect(second.statusCode, second.body).toBe(201);
      expect(
        (second.json() as { data: { onboarding_completed: boolean } }).data.onboarding_completed,
      ).toBe(true);
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

    // `UserSettingsService.get` returns platform defaults when no settings row exists and only
    // throws for an unknown user, so an authenticated caller always gets 200 — the previous
    // `[200, 404]` band could not distinguish a working route from a broken one.
    it('should return user settings', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
        token: token,
      });
      expect(response.statusCode, response.body).toBe(200);
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

    // Same reasoning as settings above: the service only 404s for an unknown user, so an
    // authenticated caller with no preference rows still gets 200 and an array.
    it('should return notification preferences', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/notification-preferences'),
        token: token,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(Array.isArray((response.json() as { data: unknown }).data)).toBe(true);
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

    // The route's declared 200 previously existed only in `src/tests/integration/
    // storage-routes-happy.integration.test.ts` — a platform file outside this domain, so a
    // scoped `VITEST_DOMAIN_FILTER=user` run never proved the avatar attach worked at all.
    it('should return 200 and expose the attached avatar on the self profile', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const key = await createConfirmedAvatarUpload(app, token);

      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/avatar'),
        token,
        payload: { avatar_key: key },
      });
      expect(response.statusCode, response.body).toBe(200);

      const me = await getMeWithRetry(app, token);
      expect(me.statusCode, me.body).toBe(200);
      expect((me.json() as { data: { avatar_url: string | null } }).data.avatar_url).toBeTruthy();
    });

    it('should clear avatar_url when the avatar is attached and then removed', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const key = await createConfirmedAvatarUpload(app, token);

      const attach = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/avatar'),
        token,
        payload: { avatar_key: key },
      });
      expect(attach.statusCode, attach.body).toBe(200);

      const remove = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/users/me/avatar'),
        token,
      });
      expect(remove.statusCode, remove.body).toBe(204);

      const me = await getMeWithRetry(app, token);
      expect((me.json() as { data: { avatar_url: string | null } }).data.avatar_url).toBeNull();
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

    // The route's declared 204 had no HTTP assertion anywhere — only the 401 above and a
    // service-level unit test. Detaching with no avatar set is a no-op that still must
    // answer 204 (and touches no object storage, since there is no key to reclaim).
    it('should return 204 for an authenticated caller and leave avatar_url null', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/users/me/avatar'),
        token,
      });
      expect(response.statusCode, response.body).toBe(204);

      const me = await getMeWithRetry(app, token);
      expect(me.statusCode, me.body).toBe(200);
      expect((me.json() as { data: { avatar_url: string | null } }).data.avatar_url).toBeNull();
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
