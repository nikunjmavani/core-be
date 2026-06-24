import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateTestTokenAndSession } from '@/tests/helpers/test-auth.js';
import { seedRecentStepUpForTestUser } from '@/tests/helpers/test-step-up.helper.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Session Sub-Domain — Integration', () => {
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

  describe('GET /api/v1/auth/me/sessions', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/sessions'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return sessions for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/sessions'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });

    it('flags the calling session is_current and exposes the derived device/browser/location fields', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: user.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/sessions'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Array<Record<string, unknown>> };
      const current = body.data.find((session) => session.id === sessionPublicId);
      expect(current).toBeDefined();
      expect(current?.is_current).toBe(true);
      // The derived display fields are always part of the contract (value may be null).
      expect(current).toHaveProperty('device');
      expect(current).toHaveProperty('browser');
      expect(current).toHaveProperty('location');
      // Only the calling session is flagged current.
      for (const session of body.data) {
        if (session.id !== sessionPublicId) {
          expect(session.is_current).toBe(false);
        }
      }
    });
  });

  describe('DELETE /api/v1/auth/me/sessions/:id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/auth/me/sessions/test-id'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('route-#9: returns 409 when revoking the CURRENT session (directs to logout)', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: user.public_id,
      });
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId); // pass the sec-A7 gate
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/sessions/${sessionPublicId}`),
        token,
      });
      expect(response.statusCode).toBe(409);
    });

    it('route-#9: a DIFFERENT session id is NOT blocked by the guard (reaches the service → 404)', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: user.public_id,
      });
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);
      // A non-current session id passes the current-session guard and reaches the service, which
      // 404s because the (non-existent) session is not the caller's — proving the guard targets
      // ONLY the current session, not every revoke.
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/sessions/${generatePublicId('authSession')}`),
        token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/auth/me/auth-methods', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/auth-methods'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return auth methods for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/auth-methods'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
