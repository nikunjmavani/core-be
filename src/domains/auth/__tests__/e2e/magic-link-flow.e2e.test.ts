import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { seedMagicLinkVerificationToken } from '@/domains/auth/__tests__/factories/magic-link-token.factory.js';
import { captureNextMagicLinkToken } from '@/tests/helpers/magic-link.helper.js';
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

  it('send → verify sets session cookie and returns access token', async () => {
    const user = await createTestUser({ email: 'magic-link-flow@example.com' });

    /** Subscribe BEFORE the send so the handler is registered when the event fires. */
    const tokenPromise = captureNextMagicLinkToken(user.email);
    const sendResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/send'),
      payload: { email: user.email },
    });
    expect(sendResponse.statusCode).toBe(201);
    const sendBody = sendResponse.json() as { data: { token?: unknown } };
    /** Raw token is never returned in the API response — only via the event payload. */
    expect(sendBody.data.token).toBeUndefined();

    const rawMagicLinkToken = await tokenPromise;
    expect(rawMagicLinkToken).toMatch(/^[0-9a-f]{64}$/);

    const verifyResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/verify'),
      payload: { token: rawMagicLinkToken },
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

  it('verify seeded magic link token sets session cookie and returns access token', async () => {
    const user = await createTestUser({ email: 'magic-link-seed@example.com' });
    const rawToken = await seedMagicLinkVerificationToken(user);

    const verifyResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/magic-link/verify'),
      payload: { token: rawToken },
    });
    expect(verifyResponse.statusCode).toBe(201);

    const verifyBody = verifyResponse.json() as {
      data: { access_token: string; session_public_id?: string };
    };
    expect(verifyBody.data.access_token).toBeTruthy();
    expect(verifyBody.data.session_public_id).toBeTruthy();

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
