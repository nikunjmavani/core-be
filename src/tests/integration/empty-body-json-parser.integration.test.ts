import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

/**
 * sec-r5-runtime regression: POST/DELETE/PATCH routes that don't require a
 * body MUST NOT 500 when a client sends `Content-Type: application/json` with
 * an empty body. Before the fix, the custom JSON content-type parser at
 * `src/app.ts` unconditionally called `JSON.parse('')` and threw
 * `SyntaxError: Unexpected end of JSON input`, which Fastify surfaced as a
 * 500. Most logout clients (curl, browser fetch with json content-type, SDKs)
 * send no body — they were all broken.
 *
 * The fix in `src/app.ts` short-circuits empty buffers to `done(null,
 * undefined)` so the route validator (Zod) sees no body and either accepts
 * or rejects per its declared schema.
 *
 * A later pentest finding extended this suite: a MALFORMED (unparseable) body
 * must surface as a clean 400, not a 500 — the parser tags its error with
 * `statusCode: 400` (mirroring Fastify's `FST_ERR_CTP_INVALID_JSON_SYNTAX`) so
 * the error handler returns a client error instead of masking it as a 5xx.
 */
describe('Integration: JSON content-type parser (empty + malformed bodies)', () => {
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

  it('POST /auth/logout with empty body + application/json returns 204 (not 500)', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/logout'),
      token,
      // Headers explicitly set Content-Type without providing a body — the
      // exact scenario that triggered the 500.
      headers: { 'content-type': 'application/json' },
      // No payload field — empty body.
    });

    // Either 200 or 204 acceptable; both indicate the route reached its
    // handler and completed normally. 500 means the parser blew up before
    // the handler ran.
    expect([201]).toContain(response.statusCode);
  });

  it('Unauthenticated POST /auth/logout with empty body still 401 (not 500)', async () => {
    // The route's own validator rejects on missing auth — which it does as
    // long as the parser doesn't 500 first.
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/logout'),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /auth/login with valid JSON body still parses (regression sanity)', async () => {
    const user = await createTestUser({ email: 'parser-sanity@example.com' });

    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      headers: { 'content-type': 'application/json' },
      payload: { email: user.email, password: 'wrong-password' },
    });

    // Wrong password → 401 from the auth service, which means the parser
    // correctly parsed the body and routed to the controller.
    expect([400, 401, 403]).toContain(response.statusCode);
  });

  // Pentest regression: a malformed (unparseable) JSON body is a CLIENT error. The custom parser
  // used to pass the raw `SyntaxError` (which carries no statusCode) to the error handler, which
  // masked it as a 500 — the wrong status (the contract is 400 on bad input) and a needless
  // Sentry-captured 5xx on attacker-controllable input. It must now be a clean 400.
  it.each([
    ['truncated JSON', '{"email":'],
    ['non-JSON text', 'not-json-at-all'],
    ['trailing comma', '{"email":"a@b.com",}'],
  ])('POST /auth/login with %s body returns 400 (not 500)', async (_label, body) => {
    const response = await app.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      headers: { 'content-type': 'application/json' },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const responseBody = response.json() as { error: { type: string; code: string } };
    expect(responseBody.error.type).toBe('request_error');
    // Never the masked 5xx envelope.
    expect(responseBody.error.code).not.toBe('internal_error');
  });
});
