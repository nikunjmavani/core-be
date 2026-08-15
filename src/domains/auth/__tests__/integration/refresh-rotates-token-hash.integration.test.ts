import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';

function sessionIdCookiePairFromLoginResponse(loginResponseHeaders: {
  'set-cookie'?: string | string[];
}): string {
  const cookiesRaw = loginResponseHeaders['set-cookie'];
  let sessionHeader: string | undefined;
  if (Array.isArray(cookiesRaw)) {
    sessionHeader = cookiesRaw.find((cookie) => cookie.startsWith('session_id='));
  } else if (typeof cookiesRaw === 'string' && cookiesRaw.startsWith('session_id=')) {
    sessionHeader = cookiesRaw;
  }
  expect(sessionHeader).toBeDefined();
  return String(sessionHeader).split(';')[0]!.trim();
}

describe('refresh rotates session token hash', () => {
  let application: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    application = testApplication;
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('old access token is rejected after refresh; new token works on GET /users/me', async () => {
    const { user, password } = await createTestUserWithPassword();

    const loginResponse = await injectUnauthenticated(application, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email: user.email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const oldAccessToken = (loginResponse.json() as { data: { access_token: string } }).data
      .access_token;
    const cookiePair = sessionIdCookiePairFromLoginResponse(loginResponse.headers);

    const refreshResponse = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/refresh'),
      headers: { cookie: cookiePair, origin: 'http://localhost:3000' },
      payload: {},
    });
    expect(refreshResponse.statusCode).toBe(200);
    const newAccessToken = (refreshResponse.json() as { data: { access_token: string } }).data
      .access_token;
    expect(newAccessToken).not.toBe(oldAccessToken);

    const meWithOldToken = await injectAuthenticated(application, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token: oldAccessToken,
    });
    expect(meWithOldToken.statusCode).toBe(401);

    const meWithNewToken = await injectAuthenticated(application, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token: newAccessToken,
    });
    expect(meWithNewToken.statusCode).toBe(200);
  });
});
