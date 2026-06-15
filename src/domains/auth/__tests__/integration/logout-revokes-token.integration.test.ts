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

describe('logout revokes access token (session binding)', () => {
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

  it('login → GET /users/me → logout → GET /users/me with same bearer returns 401', async () => {
    const { user, password } = await createTestUserWithPassword();

    const loginResponse = await injectUnauthenticated(application, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email: user.email, password },
    });
    expect(loginResponse.statusCode).toBe(201);
    const accessToken = (loginResponse.json() as { data: { access_token: string } }).data
      .access_token;

    const meBeforeLogout = await injectAuthenticated(application, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token: accessToken,
    });
    expect(meBeforeLogout.statusCode).toBe(200);

    const logoutResponse = await injectAuthenticated(application, {
      method: 'POST',
      url: testApiPath('/auth/logout'),
      token: accessToken,
    });
    expect([201]).toContain(logoutResponse.statusCode);

    const meAfterLogout = await injectAuthenticated(application, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token: accessToken,
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });
});
