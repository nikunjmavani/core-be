import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestTokenWithActiveSession } from '@/tests/helpers/test-auth.js';
import { seedRecentStepUpForTestUser } from '@/tests/helpers/test-step-up.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Auth WebAuthn — Integration', () => {
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

  describe('POST /api/v1/auth/webauthn/register/options', () => {
    it('should return registration options for authenticated user', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenWithActiveSession(
        app,
        user.public_id,
      );
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/register/options'),
        token,
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        data: { options: { challenge: string }; challenge_token: string };
      };
      expect(body.data.options.challenge).toBeTruthy();
      expect(body.data.challenge_token).toBeTruthy();
    });

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/register/options'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/auth/webauthn/register/verify', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/register/verify'),
        payload: { challenge_token: 'a'.repeat(64), response: { id: 'x', type: 'public-key' } },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for invalid body', async () => {
      const user = await createTestUser();
      const { token } = await generateTestTokenWithActiveSession(app, user.public_id);
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/register/verify'),
        token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('POST /api/v1/auth/webauthn/authenticate/options', () => {
    it('should return 400 when email is omitted (anti-enumeration)', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/authenticate/options'),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/auth/webauthn/authenticate/verify', () => {
    it('should return 400 for invalid body', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/authenticate/verify'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });
});
