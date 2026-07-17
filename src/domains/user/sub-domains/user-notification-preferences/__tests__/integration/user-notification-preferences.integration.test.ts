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

describe('User Notification Preferences Sub-Domain — Integration', () => {
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

  describe('PUT /api/v1/users/me/notification-preferences', () => {
    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/notification-preferences'),
        payload: { preferences: [] },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 or 422 for invalid preferences payload', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/notification-preferences'),
        token,
        payload: { unknown_field: true },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('returns 422 (not 500) for a channel outside the allowed set', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      // An unknown channel must be rejected by the DTO, not slip through to the
      // chk_user_notif_prefs_channel database check and surface as a 500.
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/notification-preferences'),
        token,
        payload: {
          preferences: [
            {
              notification_type: 'billing.usage_threshold',
              channel: 'TELEPATHY',
              is_enabled: true,
            },
          ],
        },
      });
      expect([400, 422]).toContain(response.statusCode);
      expect(response.statusCode).toBeLessThan(500);
    });

    it('returns 400 (not 500) when organization_id is set — org-scoped prefs unsupported here', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      // This user-scoped route has no tenant context, so a non-null organization_id can never
      // satisfy the RLS org branch and must be rejected, not surface as a raw 42501 -> 500.
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/notification-preferences'),
        token,
        payload: {
          preferences: [
            {
              notification_type: 'billing.usage_threshold',
              channel: 'EMAIL',
              organization_id: 12345,
              is_enabled: true,
            },
          ],
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('accepts a valid uppercase channel', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath('/users/me/notification-preferences'),
        token,
        payload: {
          preferences: [
            { notification_type: 'billing.usage_threshold', channel: 'EMAIL', is_enabled: true },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
