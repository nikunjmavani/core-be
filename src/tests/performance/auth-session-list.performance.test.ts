import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestTokenWithActiveSession } from '@/tests/helpers/test-auth.js';

/**
 * Auth had no performance coverage at all. Most auth endpoints are DELIBERATELY slow
 * (password hashing dominates), so latency budgets there would measure the hash — but
 * `GET /auth/me/sessions` is the domain's one read-heavy fan-out: a user reviewing
 * "where am I logged in?" lists every active session row. Today that is one query and
 * per-row serialization; the regression this guards is a future per-row enrichment
 * (device lookup, geo lookup, token-cache probe per session) turning the list into an
 * N+1 — every functional assertion stays green while the request cost scales with the
 * session count.
 */
const SESSION_COUNT = 15;

describe('Performance: auth session list', () => {
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

  it('GET /auth/me/sessions does not scale its work with the number of active sessions', async () => {
    const user = await createTestUser();

    // A real multi-device user: every session is a genuine row created through the
    // session service (token hash, expiry), the last one is the caller's own.
    let callerToken = '';
    for (let index = 0; index < SESSION_COUNT; index++) {
      const { token } = await generateTestTokenWithActiveSession(app, user.public_id);
      callerToken = token;
    }

    // Warm the app, connection pool, and JIT before measuring.
    await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      token: callerToken,
    });

    const started = performance.now();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      token: callerToken,
    });
    const elapsedMs = performance.now() - started;

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(SESSION_COUNT);
    // N+1 tripwire, not a latency SLO: a per-session round trip over 15 rows on a
    // containerised Postgres lands well past this bound, a single list query stays
    // far under it even on a cold CI runner.
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
