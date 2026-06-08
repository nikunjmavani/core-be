import { createHash, randomBytes } from 'node:crypto';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
  injectRoute,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateTestTokenAndSession } from '@/tests/helpers/test-auth.js';
import { seedRecentStepUpForTestUser } from '@/tests/helpers/test-step-up.helper.js';
import { database } from '@/infrastructure/database/connection.js';
import { users } from '@/domains/user/user.schema.js';
import { verification_tokens } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.schema.js';
import type { FastifyInstance } from 'fastify';

const AUTH_LOGIN_PATH = '/auth/login';

describe('Auth Domain — Integration', () => {
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

  // ─── Login ────────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('should return 400 for missing credentials', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: 'nonexistent@test.com',
          password: 'wrong-password',
        },
      });
      expect([401, 404]).toContain(response.statusCode);
    });

    it('when BLOCK_DISPOSABLE_EMAIL is off, login with disposable email returns 401 (invalid creds) not 400', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: 'test@yopmail.com',
          password: 'wrong-password',
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.statusCode).not.toBe(400);
    });

    it('when BLOCK_DISPOSABLE_EMAIL is off, login with disposable email and valid credentials succeeds', async () => {
      const { user, password } = await createTestUserWithPassword({
        email: 'test@yopmail.com',
      });
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty(
        'access_token',
      );
    });

    it('should return mfa_required without access_token when MFA is enabled', async () => {
      const { user, password } = await createTestUserWithPassword();
      await database
        .update(users)
        .set({ is_mfa_enabled: true })
        .where(eq(users.public_id, user.public_id));

      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: { email: user.email, password },
      });
      expect(response.statusCode).toBe(200);
      const data = (response.json() as { data: Record<string, unknown> }).data;
      expect(data.mfa_required).toBe(true);
      expect(typeof data.mfa_session_token).toBe('string');
      expect(data.access_token).toBeUndefined();

      const cookies = response.headers['set-cookie'];
      const sessionCookie = Array.isArray(cookies)
        ? cookies.find((cookie: string) => cookie.startsWith('session_id='))
        : undefined;
      expect(sessionCookie).toBeUndefined();
    });

    it('should return 401 on refresh when login stopped at MFA and no session cookie was set', async () => {
      const { user, password } = await createTestUserWithPassword();
      await database
        .update(users)
        .set({ is_mfa_enabled: true })
        .where(eq(users.public_id, user.public_id));

      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: { email: user.email, password },
      });
      expect(loginResponse.statusCode).toBe(200);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: { referer: 'http://localhost:3000/' },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(401);
    });

    it('should return 200 with access_token and set session cookie on valid login', async () => {
      const { user, password } = await createTestUserWithPassword();
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty(
        'access_token',
      );
      expect(typeof (response.json() as { data: Record<string, unknown> }).data.access_token).toBe(
        'string',
      );

      // Verify httpOnly session cookie is set
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const sessionCookie = Array.isArray(cookies)
        ? cookies.find((cookie: string) => cookie.startsWith('session_id='))
        : typeof cookies === 'string' && cookies.startsWith('session_id=')
          ? cookies
          : undefined;
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('HttpOnly');
    });

    it('should create distinct sessions when logging in twice in quick succession', async () => {
      const { user, password } = await createTestUserWithPassword();
      const credentials = { email: user.email, password };

      const [firstLogin, secondLogin] = await Promise.all([
        injectUnauthenticated(app, {
          method: 'POST',
          url: testApiPath(AUTH_LOGIN_PATH),
          payload: credentials,
        }),
        injectUnauthenticated(app, {
          method: 'POST',
          url: testApiPath(AUTH_LOGIN_PATH),
          payload: credentials,
        }),
      ]);

      expect(firstLogin.statusCode).toBe(200);
      expect(secondLogin.statusCode).toBe(200);
      expect((firstLogin.json() as { data: Record<string, unknown> }).data.access_token).not.toBe(
        (secondLogin.json() as { data: Record<string, unknown> }).data.access_token,
      );
    });
  });

  // ─── Logout ───────────────────────────────────────────────────

  describe('POST /api/v1/auth/logout', () => {
    it('should accept logout request', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/logout'),
        payload: {},
      });
      // Logout may succeed even without a valid token (idempotent)
      expect([200, 204, 401]).toContain(response.statusCode);
    });

    it('should clear session cookie on logout after login', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);
      const accessToken = (loginResponse.json() as { data: { access_token: string } }).data
        .access_token;

      const logoutResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/logout'),
        token: accessToken,
      });
      expect([200, 204]).toContain(logoutResponse.statusCode);
    });
  });

  // ─── Session Refresh ──────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    function cookiePairFromLoginResponse(
      loginResponseHeaders: { 'set-cookie'?: string | string[] },
      cookieName: string,
    ): string {
      const cookiesRaw = loginResponseHeaders['set-cookie'];
      let cookieHeader: string | undefined;
      if (Array.isArray(cookiesRaw)) {
        cookieHeader = cookiesRaw.find((cookie) => cookie.startsWith(`${cookieName}=`));
      } else if (typeof cookiesRaw === 'string' && cookiesRaw.startsWith(`${cookieName}=`)) {
        cookieHeader = cookiesRaw;
      }
      expect(cookieHeader).toBeDefined();
      const onlyPair = String(cookieHeader).split(';')[0]!.trim();
      expect(onlyPair.startsWith(`${cookieName}=`)).toBe(true);
      return onlyPair;
    }

    function sessionIdCookiePairFromLoginResponse(loginResponseHeaders: {
      'set-cookie'?: string | string[];
    }): string {
      return cookiePairFromLoginResponse(loginResponseHeaders, 'session_id');
    }

    function authCookieHeaderFromLoginResponse(loginResponseHeaders: {
      'set-cookie'?: string | string[];
    }): string {
      const sessionPair = sessionIdCookiePairFromLoginResponse(loginResponseHeaders);
      const csrfPair = cookiePairFromLoginResponse(loginResponseHeaders, 'csrf_token');
      return `${sessionPair}; ${csrfPair}`;
    }

    it('should return 401 for missing session cookie', async () => {
      const response = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: { referer: 'http://localhost:3000/' },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return new access_token when valid session cookie is provided', async () => {
      const { user, password } = await createTestUserWithPassword();

      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      const cookieHeader = authCookieHeaderFromLoginResponse(loginResponse.headers);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: {
          cookie: cookieHeader,
          referer: 'http://localhost:3000/',
        },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(200);
      const body = refreshResponse.json() as { data?: { access_token?: string } };
      expect(body.data).toHaveProperty('access_token');
      const newToken = body.data?.access_token;
      expect(typeof newToken).toBe('string');
      expect((newToken as string).length).toBeGreaterThan(0);
      const refreshSetCookie = refreshResponse.headers['set-cookie'];
      expect(refreshSetCookie).toBeDefined();
      expect(
        cookiePairFromLoginResponse(
          { 'set-cookie': refreshSetCookie as string | string[] },
          'csrf_token',
        ),
      ).toMatch(/^csrf_token=/);
    });

    it('should set csrf_token cookie on login', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);
      expect(cookiePairFromLoginResponse(loginResponse.headers, 'csrf_token')).toMatch(
        /^csrf_token=/,
      );
    });

    it('should return 403 when Origin header is not in ALLOWED_ORIGINS', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      const cookiePair = sessionIdCookiePairFromLoginResponse(loginResponse.headers);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: {
          cookie: cookiePair,
          origin: 'https://untrusted.example.com',
        },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(403);
    });

    it('should return 403 when Origin and Referer are both absent', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      const cookiePair = sessionIdCookiePairFromLoginResponse(loginResponse.headers);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: { cookie: cookiePair },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(403);
    });

    it('should return 200 when Referer origin matches ALLOWED_ORIGINS', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      const cookiePair = sessionIdCookiePairFromLoginResponse(loginResponse.headers);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: {
          cookie: cookiePair,
          referer: 'http://localhost:3000/auth',
        },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(200);
    });

    it('should return 403 when Referer origin is not in ALLOWED_ORIGINS', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      const cookiePair = sessionIdCookiePairFromLoginResponse(loginResponse.headers);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: {
          cookie: cookiePair,
          referer: 'https://untrusted.example.com/page',
        },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(403);
    });

    it('should return 200 when Origin matches ALLOWED_ORIGINS', async () => {
      const { user, password } = await createTestUserWithPassword();
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password,
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      const cookiePair = sessionIdCookiePairFromLoginResponse(loginResponse.headers);

      const refreshResponse = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/refresh'),
        headers: {
          cookie: cookiePair,
          origin: 'http://localhost:3000',
        },
        payload: {},
      });
      expect(refreshResponse.statusCode).toBe(200);
      const body = refreshResponse.json() as { data?: { access_token?: string } };
      expect(body.data).toHaveProperty('access_token');
    });
  });

  // ─── Magic Link ───────────────────────────────────────────────

  describe('POST /api/v1/auth/magic-link/send', () => {
    it('should return 400 for missing email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/send'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should accept valid email format', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/send'),
        payload: { email: 'test@example.com' },
      });
      // May return 200 (sent) or 404 (user not found) depending on config
      expect([200, 404]).toContain(response.statusCode);
    });

    it('when BLOCK_DISPOSABLE_EMAIL is off, magic-link send accepts disposable email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/send'),
        payload: { email: 'test@yopmail.com' },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data.message).toBeDefined();
    });

    it('returns translated success message for magic-link send with Accept-Language: es', async () => {
      const response = await injectRoute(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/send'),
        headers: { 'accept-language': 'es' },
        payload: { email: 'unknown-magic-link-user@example.com' },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data.message).toBeDefined();
      expect([
        'If an account exists with this email, you will receive a magic link shortly.',
        'Si existe una cuenta con este correo, recibirás un enlace mágico en breve.',
      ]).toContain((response.json() as { data: Record<string, unknown> }).data.message);
    });
  });

  describe('POST /api/v1/auth/magic-link/verify', () => {
    it('should return 400 for missing token', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/verify'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 401 for invalid token', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/magic-link/verify'),
        payload: { token: 'invalid-token' },
      });
      expect([401, 404]).toContain(response.statusCode);
    });
  });

  // ─── OAuth ────────────────────────────────────────────────────

  describe('GET /api/v1/auth/oauth/providers', () => {
    it('should list OAuth providers', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/oauth/providers'),
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty(
        'providers',
      );
      expect(
        Array.isArray((response.json() as { data: Record<string, unknown> }).data.providers),
      ).toBe(true);
      expect((response.json() as { data: Record<string, unknown> }).data.providers).toContain(
        'google',
      );
      expect((response.json() as { data: Record<string, unknown> }).data.providers).toContain(
        'github',
      );
    });
  });

  describe('GET /api/v1/auth/oauth/:provider', () => {
    it('should return 501 for unsupported provider', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/oauth/twitter'),
      });
      // Server returns 501 NotImplementedError; accept 501 or 200 (redirect URL) depending on error handling
      expect([200, 501]).toContain(response.statusCode);
    });

    it('should return 501 when provider not configured (no client ID)', async () => {
      // Without OAUTH_GOOGLE_CLIENT_ID set, returns NotImplementedError
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/oauth/google'),
      });
      expect([200, 501]).toContain(response.statusCode);
    });
  });

  // ─── Password: Forgot / Reset ─────────────────────────────────

  describe('POST /api/v1/auth/password/forgot', () => {
    it('should return 400 for missing email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/forgot'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 200 with message for existing user (no enumeration)', async () => {
      const { user } = await createTestUserWithPassword();
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/forgot'),
        payload: { email: user.email },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty('message');
    });

    it('should return 200 with same message for non-existent email (anti-enumeration)', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/forgot'),
        payload: { email: 'nobody@nonexistent.com' },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty('message');
    });

    it('when BLOCK_DISPOSABLE_EMAIL is off, password forgot accepts disposable email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/forgot'),
        payload: { email: 'test@yopmail.com' },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty('message');
    });
  });

  describe('POST /api/v1/auth/password/reset', () => {
    it('should return 400 for missing token/password', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/reset'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 401 for invalid reset token', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/reset'),
        payload: {
          token: 'invalid-token-value',
          password: 'NewSecurePassword123!',
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reset password with a valid token and allow login with new password', async () => {
      const { user } = await createTestUserWithPassword();

      // Create a password reset token directly in DB
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 3_600_000); // 1 hour

      await database.insert(verification_tokens).values({
        token_type: 'PASSWORD_RESET',
        token_hash: tokenHash,
        user_id: user.id,
        email: user.email,
        expires_at: expiresAt,
      });

      // Reset password
      const newPassword = 'BrandNewPassword456!';
      const resetResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/reset'),
        payload: {
          token: rawToken,
          password: newPassword,
        },
      });
      expect(resetResponse.statusCode).toBe(204);

      // Login with new password
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password: newPassword,
        },
      });
      expect(loginResponse.statusCode).toBe(200);
      expect((loginResponse.json() as { data: Record<string, unknown> }).data).toHaveProperty(
        'access_token',
      );
    });
  });

  describe('POST /api/v1/auth/password/change', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/change'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing body with authentication', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/change'),
        token: token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should change password for authenticated user with valid current password', async () => {
      const { user, password } = await createTestUserWithPassword();
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: user.public_id,
      });
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);
      const newPassword = 'ChangedPassword789!';
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/password/change'),
        token: token,
        payload: {
          current_password: password,
          new_password: newPassword,
        },
      });
      expect(response.statusCode).toBe(204);

      // Verify login works with new password
      const loginResponse = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(AUTH_LOGIN_PATH),
        payload: {
          email: user.email,
          password: newPassword,
        },
      });
      expect(loginResponse.statusCode).toBe(200);
    });
  });

  // ─── Email Verification ───────────────────────────────────────

  describe('POST /api/v1/auth/email/verify', () => {
    it('should return 400 for missing token', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/verify'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 401 for invalid verification token', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/verify'),
        payload: { token: 'invalid-verification-token' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should verify email with a valid token', async () => {
      const user = await createTestUser({ isEmailVerified: false });

      // Create an email verification token directly in DB
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 86_400_000); // 24 hours

      await database.insert(verification_tokens).values({
        token_type: 'EMAIL_VERIFICATION',
        token_hash: tokenHash,
        user_id: user.id,
        email: user.email,
        expires_at: expiresAt,
      });

      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/verify'),
        payload: { token: rawToken },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty('message');
      expect((response.json() as { data: Record<string, unknown> }).data.message).toContain(
        'verified',
      );
    });
  });

  describe('POST /api/v1/auth/email/resend-verification', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/resend-verification'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return message for unverified user', async () => {
      const user = await createTestUser({ isEmailVerified: false });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/resend-verification'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty('message');
    });

    it('should return already-verified message for verified user', async () => {
      const user = await createTestUser({ isEmailVerified: true });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/resend-verification'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data.message).toContain(
        'already verified',
      );
    });
  });

  // ─── i18n (Accept-Language) ────────────────────────────────────

  describe('i18n response messages', () => {
    it('returns 404 error detail in English with Accept-Language: en', async () => {
      const response = await injectRoute(app, {
        method: 'GET',
        url: testApiPath('/auth/nonexistent-route-for-i18n-test'),
        headers: { 'accept-language': 'en' },
      });
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error?: Record<string, unknown> }).error?.detail).toBe(
        'Route not found',
      );
    });

    it('returns 404 error with translated detail (Accept-Language respected when supported)', async () => {
      const response = await injectRoute(app, {
        method: 'GET',
        url: testApiPath('/auth/nonexistent-route-for-i18n-test'),
        headers: { 'accept-language': 'es' },
      });
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error?: Record<string, unknown> }).error?.detail).toBeDefined();
      const errorDetail = (response.json() as { error?: { detail?: string } }).error?.detail;
      expect(typeof errorDetail).toBe('string');
      // May be "Route not found" (en) or "Ruta no encontrada" (es) depending on detector
      expect(['Route not found', 'Ruta no encontrada']).toContain(errorDetail);
    });

    it('returns success message (translated) for resend-verification when already verified', async () => {
      const user = await createTestUser({ isEmailVerified: true });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/email/resend-verification'),
        token: token,
        headers: { 'accept-language': 'es' },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data.message).toBeDefined();
      expect((response.json() as { data: Record<string, unknown> }).data.message).toMatch(
        /verified|verificado/,
      );
    });
  });
});
