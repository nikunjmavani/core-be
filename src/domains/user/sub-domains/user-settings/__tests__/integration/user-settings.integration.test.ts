import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('User Settings Sub-Domain — Integration', () => {
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

  describe('GET /api/v1/users/me/settings', () => {
    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
      });
      expect(response.statusCode).toBe(401);
    });

    // A user with no `user_settings` row still gets the platform defaults rather than a 404 —
    // the serializer's whole purpose ("the API never returns settings not found").
    it('returns 200 with the platform defaults before any settings row exists', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
        token,
      });

      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toMatchObject({
        is_dark_mode_enabled: false,
        is_notifications_enabled: true,
        language: 'en',
        preferred_locales: ['en'],
      });
    });
  });

  describe('PATCH /api/v1/users/me/settings', () => {
    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me/settings'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 or 422 for invalid body', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me/settings'),
        token,
        payload: { unknown_field: true },
      });
      expect(response.statusCode).toBe(400);
    });

    // The route's declared 200 had no assertion anywhere in the repository — only a 401 and an
    // invalid-body case, so nothing proved a settings update ever succeeded over HTTP.
    it('returns 200 and echoes the updated settings', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me/settings'),
        token,
        payload: { is_dark_mode_enabled: true, language: 'es' },
      });

      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toMatchObject({
        is_dark_mode_enabled: true,
        language: 'es',
      });
    });

    it('persists the patch so a following GET reads it back', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      const patch = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/users/me/settings'),
        token,
        payload: { is_dark_mode_enabled: true },
      });
      expect(patch.statusCode, patch.body).toBe(200);

      const read = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me/settings'),
        token,
      });
      expect(read.statusCode, read.body).toBe(200);
      expect((read.json() as { data: Record<string, unknown> }).data).toMatchObject({
        is_dark_mode_enabled: true,
        // Untouched fields keep their defaults — the service merges rather than replaces.
        is_notifications_enabled: true,
      });
    });
  });
});
