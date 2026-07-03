import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import type { InjectHttpResult } from '@/tests/helpers/test-http-inject.helper.js';

/**
 * Account-enumeration resistance for the public auth surface.
 *
 * The service layer is already built to not leak account existence — the login
 * unknown-account branch runs a dummy Argon2 verify so its timing matches a real
 * wrong-password attempt and throws the same `invalidEmailOrPassword`, while
 * forgot-password / email-code return a generic response on the unknown branch.
 * Those are security-critical invariants with no HTTP-level regression guard:
 * the legacy login test even permitted a 404 for an unknown email. This suite
 * locks the parity so a future refactor cannot reintroduce an oracle.
 */
function errorIdentity(response: InjectHttpResult): {
  code: string | undefined;
  detail: string | undefined;
} {
  const body = response.json() as { code?: string; detail?: string } | undefined;
  // requestId is the only volatile field on the error envelope; compare the rest.
  return { code: body?.code, detail: body?.detail };
}

function responseData(response: InjectHttpResult): unknown {
  // Success envelope is `{ data, meta: { request_id } }`; meta carries the only
  // per-request-volatile field, so the enumeration-relevant content is `data`.
  const body = response.json() as { data?: unknown } | undefined;
  return body?.data;
}

describe('Security: auth account-enumeration resistance', () => {
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

  function login(email: string, password: string) {
    return injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email, password },
    });
  }

  function forgotPassword(email: string) {
    return injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/password/forgot'),
      payload: { email },
    });
  }

  function sendMagicLink(email: string) {
    return injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email },
    });
  }

  it('login: an unknown email and a wrong password return an identical 401 (no enumeration)', async () => {
    await createTestUserWithPassword({
      email: 'enumeration-known@example.com',
      password: 'CorrectHorseBattery1!',
      isEmailVerified: true,
    });

    const wrongPassword = await login('enumeration-known@example.com', 'TotallyWrongPassword9!');
    const unknownEmail = await login('enumeration-absent@example.com', 'TotallyWrongPassword9!');

    // Same status and the same error identity — neither response reveals whether the account exists.
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
    expect(errorIdentity(unknownEmail)).toEqual(errorIdentity(wrongPassword));
  });

  it('password/forgot: known and unknown emails return an identical generic response', async () => {
    await createTestUserWithPassword({
      email: 'enumeration-forgot@example.com',
      isEmailVerified: true,
    });

    const known = await forgotPassword('enumeration-forgot@example.com');
    const unknown = await forgotPassword('enumeration-forgot-absent@example.com');

    expect(known.statusCode).toBe(201);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(responseData(unknown)).toEqual(responseData(known));
  });

  it('email/send-code: known and unknown emails return an identical generic response', async () => {
    await createTestUserWithPassword({
      email: 'enumeration-magic@example.com',
      isEmailVerified: true,
    });

    const known = await sendMagicLink('enumeration-magic@example.com');
    const unknown = await sendMagicLink('enumeration-magic-absent@example.com');

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(responseData(unknown)).toEqual(responseData(known));
  });
});
