import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { seedMagicLinkVerificationCode } from '@/domains/auth/__tests__/factories/magic-link-token.factory.js';
import { captureNextMagicLinkCode } from '@/tests/helpers/magic-link.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Auth e2e: magic link flow', () => {
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

  it('accepts magic link send request', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/send'),
      payload: { email: 'magic-link-e2e@example.com' },
    });
    expect(response.statusCode).toBe(201);
  });

  it('auto-signup: an unknown email is created on send and can verify immediately', async () => {
    const email = 'magic-link-autosignup@example.com';

    /** Subscribe BEFORE the send so the handler is registered when the event fires. */
    const codePromise = captureNextMagicLinkCode(email);
    const sendResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/send'),
      payload: { email },
    });
    expect(sendResponse.statusCode).toBe(201);

    const code = await codePromise;
    expect(code).toMatch(/^\d{6}$/);

    const verifyResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/verify'),
      payload: { email, code },
    });
    expect(verifyResponse.statusCode).toBe(201);
    const verifyBody = verifyResponse.json() as { data: { access_token?: string } };
    expect(verifyBody.data.access_token).toBeTruthy();

    // The verified session can reach an authenticated endpoint, proving the auto-created user is
    // real and logged in (and that magic-link verify flipped is_email_verified).
    const meResponse = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/context'),
      headers: { authorization: `Bearer ${verifyBody.data.access_token}` },
    });
    expect(meResponse.statusCode).toBe(200);
    const meBody = meResponse.json() as {
      data: { user: { email: string; is_email_verified: boolean } };
    };
    expect(meBody.data.user.email).toBe(email);
    expect(meBody.data.user.is_email_verified).toBe(true);
  });

  it('send → verify sets session cookie and returns access token', async () => {
    const user = await createTestUser({ email: 'magic-link-flow@example.com' });

    /** Subscribe BEFORE the send so the handler is registered when the event fires. */
    const codePromise = captureNextMagicLinkCode(user.email);
    const sendResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/send'),
      payload: { email: user.email },
    });
    expect(sendResponse.statusCode).toBe(201);
    const sendBody = sendResponse.json() as { data: { code?: unknown } };
    /** Raw code is never returned in the API response — only via the event payload. */
    expect(sendBody.data.code).toBeUndefined();

    const code = await codePromise;
    expect(code).toMatch(/^\d{6}$/);

    const verifyResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/verify'),
      payload: { email: user.email, code },
    });
    expect(verifyResponse.statusCode).toBe(201);
    expect((verifyResponse.json() as { data: Record<string, unknown> }).data).toHaveProperty(
      'access_token',
    );

    const cookies = verifyResponse.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sessionCookie = Array.isArray(cookies)
      ? cookies.find((cookie: string) => cookie.startsWith('session_id='))
      : typeof cookies === 'string' && cookies.startsWith('session_id=')
        ? cookies
        : undefined;
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
  });

  it('verify seeded magic link code sets session cookie and returns access token', async () => {
    const user = await createTestUser({ email: 'magic-link-seed@example.com' });
    const code = await seedMagicLinkVerificationCode(user);

    const verifyResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/verify'),
      payload: { email: user.email, code },
    });
    expect(verifyResponse.statusCode).toBe(201);

    const verifyBody = verifyResponse.json() as {
      data: { access_token: string; session_id?: string };
    };
    expect(verifyBody.data.access_token).toBeTruthy();
    expect(verifyBody.data.session_id).toBeTruthy();

    const cookies = verifyResponse.headers['set-cookie'];
    const sessionCookie = Array.isArray(cookies)
      ? cookies.find((cookie: string) => cookie.startsWith('session_id='))
      : typeof cookies === 'string' && cookies.startsWith('session_id=')
        ? cookies
        : undefined;
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
  });
});
