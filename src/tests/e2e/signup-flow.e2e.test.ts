import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import {
  injectUnauthenticated,
  injectAuthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * The documented `signup-flow` (src/FLOWS.md, auth/user overviews): a brand-new email
 * completes passwordless email verification-code login, which materializes the `users`
 * row via `UserService.findOrCreate` and issues the first session. This file previously
 * asserted a PASSWORD login of a pre-created user — i.e. the login-flow, not the
 * signup-flow it is named for, so a regression in the actual first-time signup path
 * (send-code → verify → user materialization) had no e2e guard. Corrected to drive the
 * real journey end to end.
 */
describe('Cross-domain e2e: signup flow (email verification-code)', () => {
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

  it('new email → send-code → verify code → session + materialized profile', async () => {
    // A never-seen email: send-code auto-provisions and email/login find-or-creates the
    // user, so this is a true first-time signup, not a login of a seeded account.
    const newUserEmail = `signup-${randomUUID()}@example.com`;

    const sendCodeResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email: newUserEmail },
    });
    expect(sendCodeResponse.statusCode).toBe(200);
    // TEST_MODE echoes the freshly issued code so the e2e can complete the verify step
    // without reading the mail outbox (the code never leaves the server outside TEST_MODE).
    const verificationCode = (
      sendCodeResponse.json() as { data?: { debug_verification_code?: string } }
    ).data?.debug_verification_code;
    expect(verificationCode, 'TEST_MODE must echo the verification code').toBeTruthy();

    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email: newUserEmail, code: verificationCode },
    });
    expect(loginResponse.statusCode).toBe(200);
    const token = (loginResponse.json() as { data?: { access_token?: string } }).data?.access_token;
    expect(token, 'email/login mints the first session access token').toBeTruthy();

    // The user row was materialized by the signup — the profile it issued a token for
    // must be readable with that token.
    const profileResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token: token as string,
    });
    expect(profileResponse.statusCode).toBe(200);
    const profile = (profileResponse.json() as { data?: { email?: string } }).data;
    expect(profile?.email).toBe(newUserEmail);
  });
});
