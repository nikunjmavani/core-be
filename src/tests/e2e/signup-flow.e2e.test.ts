import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import {
  injectUnauthenticated,
  injectAuthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Cross-domain e2e: signup flow', () => {
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

  it('logs in seeded user then loads profile', async () => {
    const { user, password } = await createTestUserWithPassword();
    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {
        email: user.email,
        password,
      },
    });
    expect(loginResponse.statusCode).toBe(200);
    const token = (loginResponse.json() as { data?: { access_token?: string } }).data?.access_token;
    expect(token).toBeDefined();

    const profileResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token: token as string,
    });
    expect(profileResponse.statusCode).toBe(200);
  });
});
