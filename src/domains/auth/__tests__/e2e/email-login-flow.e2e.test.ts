import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { seedEmailVerificationCode } from '@/domains/auth/__tests__/factories/verification-code-token.factory.js';
import { captureNextVerificationCode } from '@/tests/helpers/verification-code.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Auth e2e: email verification-code login flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('accepts send-code request', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email: 'email-login-e2e@example.com' },
    });
    expect(response.statusCode).toBe(201);
  });

  it('auto-signup: an unknown email is created on send and can log in immediately', async () => {
    const email = 'email-login-autosignup@example.com';

    /** Subscribe BEFORE the send so the handler is registered when the event fires. */
    const codePromise = captureNextVerificationCode(email);
    const sendResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email },
    });
    expect(sendResponse.statusCode).toBe(201);

    const code = await codePromise;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email, code },
    });
    expect(loginResponse.statusCode).toBe(201);
    const loginBody = loginResponse.json() as { data: { access_token?: string } };
    expect(loginBody.data.access_token).toBeTruthy();

    // The session can reach an authenticated endpoint, proving the auto-created user is real and
    // logged in (and that login flipped is_email_verified).
    const meResponse = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/context'),
      headers: { authorization: `Bearer ${loginBody.data.access_token}` },
    });
    expect(meResponse.statusCode).toBe(200);
    const meBody = meResponse.json() as {
      data: { user: { email: string; is_email_verified: boolean } };
    };
    expect(meBody.data.user.email).toBe(email);
    expect(meBody.data.user.is_email_verified).toBe(true);
  });

  it('send → login sets session cookie and returns access token', async () => {
    const user = await createTestUser({ email: 'email-login-flow@example.com' });

    /** Subscribe BEFORE the send so the handler is registered when the event fires. */
    const codePromise = captureNextVerificationCode(user.email);
    const sendResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email: user.email },
    });
    expect(sendResponse.statusCode).toBe(201);
    const sendBody = sendResponse.json() as { data: { code?: unknown } };
    /** Raw code is never returned in the API response — only via the event payload. */
    expect(sendBody.data.code).toBeUndefined();

    const code = await codePromise;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email: user.email, code },
    });
    expect(loginResponse.statusCode).toBe(201);
    expect((loginResponse.json() as { data: Record<string, unknown> }).data).toHaveProperty(
      'access_token',
    );

    const cookies = loginResponse.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sessionCookie = Array.isArray(cookies)
      ? cookies.find((cookie: string) => cookie.startsWith('session_id='))
      : typeof cookies === 'string' && cookies.startsWith('session_id=')
        ? cookies
        : undefined;
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
  });

  it('login with a seeded code sets session cookie and returns access token + session id', async () => {
    const user = await createTestUser({ email: 'email-login-seed@example.com' });
    const code = await seedEmailVerificationCode(user);

    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email: user.email, code },
    });
    expect(loginResponse.statusCode).toBe(201);

    const loginBody = loginResponse.json() as {
      data: { access_token: string; session_id?: string };
    };
    expect(loginBody.data.access_token).toBeTruthy();
    expect(loginBody.data.session_id).toBeTruthy();

    const cookies = loginResponse.headers['set-cookie'];
    const sessionCookie = Array.isArray(cookies)
      ? cookies.find((cookie: string) => cookie.startsWith('session_id='))
      : typeof cookies === 'string' && cookies.startsWith('session_id=')
        ? cookies
        : undefined;
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
  });

  it('redeeming a code invalidates any other live code for the user (single-use)', async () => {
    const user = await createTestUser({ email: 'email-login-singleuse@example.com' });
    // Seed two live codes directly (normal sends keep only one live; this exercises the login-time
    // invalidate-all guard against any concurrent-send race that could leave more than one live).
    const firstCode = await seedEmailVerificationCode(user);
    const secondCode = await seedEmailVerificationCode(user);
    expect(firstCode).not.toBe(secondCode);

    const firstLogin = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email: user.email, code: firstCode },
    });
    expect(firstLogin.statusCode).toBe(201);

    // Redeeming the first code invalidated every other live code, so the still-unexpired second fails.
    const secondLogin = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email: user.email, code: secondCode },
    });
    expect(secondLogin.statusCode).toBe(401);
  });
});
