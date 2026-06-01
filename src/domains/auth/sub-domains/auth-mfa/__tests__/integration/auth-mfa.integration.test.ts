import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';

describe('MFA Sub-Domain — Integration', () => {
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

  describe('POST /api/v1/auth/mfa/login', () => {
    it('should return 400 for missing body', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    // Issue #1 regression: a TOTP code alone (without a valid mfa_session_token
    // minted by POST /auth/login after password verification) must never mint a
    // session. The session token is unforgeable, so an attacker who only knows a
    // victim's user id and a 6-digit code cannot log in.
    it('should return 401 for a TOTP code without a valid mfa_session_token', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: {
          mfa_session_token: 'forged-or-expired-token',
          totp_code: '123456',
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should no longer expose the removed public /auth/mfa/challenge route', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/challenge'),
        payload: { user_id: 'any-user', code: '123456' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/auth/mfa', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/mfa'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return MFA methods for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/mfa'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/auth/mfa/:mfaMethodId', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/auth/mfa/test-id'),
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
