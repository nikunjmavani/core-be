import { generate as generateTotpCode } from 'otplib';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser, createTestUserWithPassword } from '@/tests/factories/user.factory.js';
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

  describe('GET /api/v1/auth/me/mfa', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/mfa'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return MFA methods for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/mfa'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/auth/me/mfa/:mfa_method_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/auth/me/mfa/test-id'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('full TOTP ceremony (enroll → confirm → verify → mfa login)', () => {
    it('completes step-up verify and the public mfa login with valid TOTP codes', async () => {
      const { user, password } = await createTestUserWithPassword({ isEmailVerified: true });
      const token = await generateTestToken({ userId: user.public_id });

      const stepUp = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/step-up'),
        token,
        payload: { password },
      });
      expect(stepUp.statusCode, stepUp.body).toBe(201);

      const enroll = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll'),
        token,
        payload: { method_type: 'MFA_TOTP' },
      });
      expect(enroll.statusCode, enroll.body).toBe(201);
      const { secret } = (enroll.json() as { data: { secret: string } }).data;
      expect(secret).toBeTypeOf('string');

      const confirm = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll/confirm'),
        token,
        payload: { code: await generateTotpCode({ secret }) },
      });
      expect(confirm.statusCode, confirm.body).toBe(201);

      // Authenticated step-up verification. Consumed codes are replay-protected
      // within their window, so use the NEXT 30s window (server tolerance ±1 step).
      const verify = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        token,
        payload: {
          // otplib `epoch` is in SECONDS; +30s = next TOTP window (server tolerance ±1 step).
          code: await generateTotpCode({ secret, epoch: Math.floor(Date.now() / 1000) + 30 }),
        },
      });
      expect(verify.statusCode, verify.body).toBe(201);

      // Password login now returns the MFA challenge envelope instead of a token.
      const login = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/login'),
        payload: { email: user.email, password },
      });
      expect(login.statusCode, login.body).toBe(201);
      const loginBody = (
        login.json() as { data: { mfa_required?: boolean; mfa_session_token?: string } }
      ).data;
      expect(loginBody.mfa_required).toBe(true);
      expect(loginBody.mfa_session_token).toBeTypeOf('string');

      // Public MFA completion mints the real access token.
      const mfaLogin = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: {
          mfa_session_token: loginBody.mfa_session_token,
          // Previous 30s window (epoch in seconds) — distinct from the codes consumed above.
          totp_code: await generateTotpCode({ secret, epoch: Math.floor(Date.now() / 1000) - 30 }),
        },
      });
      expect(mfaLogin.statusCode, mfaLogin.body).toBe(201);
      const mfaLoginBody = (mfaLogin.json() as { data: { access_token?: string } }).data;
      expect(mfaLoginBody.access_token).toBeTypeOf('string');
    });
  });

  describe('pre-hijacking guard: unverified email cannot seed a login factor', () => {
    it('rejects MFA enrollment with 403 for an UNVERIFIED account, even after a valid step-up', async () => {
      // Account pre-hijacking (Trojan-credential variant): an attacker who pre-registers a
      // victim's email holds an UNVERIFIED account whose password they set. A password step-up is
      // a factor they control, so it must NOT let them seed an MFA method — which would survive the
      // victim's password-reset recovery (reset revokes sessions, not enrolled factors). Email
      // verification is the gate that the pre-registering attacker cannot pass.
      const { user, password } = await createTestUserWithPassword({ isEmailVerified: false });
      const token = await generateTestToken({ userId: user.public_id });

      const stepUp = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/step-up'),
        token,
        payload: { password },
      });
      expect(stepUp.statusCode, stepUp.body).toBe(201);

      const enroll = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/enroll'),
        token,
        payload: { method_type: 'MFA_TOTP' },
      });
      expect(enroll.statusCode, enroll.body).toBe(403);
      expect((enroll.json() as { error: { code: string } }).error.code).toBe('forbidden');
    });
  });
});
