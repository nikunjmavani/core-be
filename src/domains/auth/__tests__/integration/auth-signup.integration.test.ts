import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { users } from '@/domains/user/user.schema.js';
import type { FastifyInstance } from 'fastify';

const SIGNUP_PATH = '/auth/signup';
// 16 chars, 4 character classes — satisfies the shared password strength policy.
const STRONG_PASSWORD = 'Str0ng-Pass!word';

describe('Auth Domain — Signup (integration)', () => {
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

  it('creates the account, logs the user in, and leaves the email unverified', async () => {
    const email = 'new.signup@example.com';
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath(SIGNUP_PATH),
      payload: { email, password: STRONG_PASSWORD, first_name: 'Ada' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { data: { access_token?: string } };
    expect(body.data.access_token).toBeTruthy();
    // Auto-login also sets the httpOnly refresh session cookie.
    expect(response.headers['set-cookie']).toBeDefined();

    // The account exists and the email starts unverified (login is allowed before verification).
    const [row] = await database
      .select({ is_email_verified: users.is_email_verified })
      .from(users)
      .where(eq(users.email, email));
    expect(row?.is_email_verified).toBe(false);
  });

  it('returns 409 when an account with the email already exists', async () => {
    const { user } = await createTestUserWithPassword({ email: 'taken@example.com' });
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath(SIGNUP_PATH),
      payload: { email: user.email, password: STRONG_PASSWORD },
    });
    expect(response.statusCode).toBe(409);
  });

  it('rejects a password that fails the strength policy', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath(SIGNUP_PATH),
      payload: { email: 'weak.signup@example.com', password: 'short' },
    });
    expect([400, 422]).toContain(response.statusCode);
  });

  it('rejects a request missing the email', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath(SIGNUP_PATH),
      payload: { password: STRONG_PASSWORD },
    });
    expect([400, 422]).toContain(response.statusCode);
  });
});
