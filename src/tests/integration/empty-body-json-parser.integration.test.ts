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
 */
describe('Integration: empty-body JSON parser (sec-r5-runtime)', () => {
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
    expect([200, 204]).toContain(response.statusCode);
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
});
