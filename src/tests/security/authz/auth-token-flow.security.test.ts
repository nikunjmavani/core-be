import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateTestTokenAndSession } from '@/tests/helpers/test-auth.js';
import { database } from '@/infrastructure/database/connection.js';
import { sessions } from '@/domains/auth/sub-domains/auth-session/auth-session.schema.js';

/**
 * Authentication / token-lifecycle matrix. Complements the cryptographic JWT
 * claim attacks in `src/tests/security/auth/jwt-attacks.security.test.ts`
 * (expired / tampered / wrong-key / wrong issuer-audience) by exercising the
 * two things those do not: the bearer-header contract, and stateful session
 * revocation — a structurally valid, correctly signed token whose session has
 * been revoked must still be rejected, proving the middleware validates an
 * active session per request rather than trusting the JWT statelessly.
 * Target: GET /auth/me/sessions (bearer-only). e2e — runs in CI (Postgres + Redis).
 */
describe('Security: auth token / session lifecycle', () => {
  let app: FastifyInstance;
  const PROTECTED_ROUTE = '/auth/me/sessions';

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('baseline: a valid bearer reaches the protected route → 200', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const res = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED_ROUTE),
      token,
    });
    expect(res.statusCode).toBe(200);
  });

  it('no Authorization header → 401', async () => {
    const res = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED_ROUTE),
    });
    expect(res.statusCode).toBe(401);
  });

  it('malformed Authorization header (no Bearer scheme) → 401', async () => {
    const res = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED_ROUTE),
      headers: { authorization: 'not-a-bearer-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('Bearer scheme with a structurally invalid token → 401', async () => {
    const res = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED_ROUTE),
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid, correctly signed bearer whose session was revoked → 401', async () => {
    const user = await createTestUser();
    const { token, sessionPublicId } = await generateTestTokenAndSession({
      userId: user.public_id,
    });
    // Revoke the session out-of-band; the JWT itself is still unexpired and valid.
    await database
      .update(sessions)
      .set({ is_revoked: true })
      .where(eq(sessions.public_id, sessionPublicId));
    const res = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED_ROUTE),
      token,
    });
    expect(res.statusCode).toBe(401);
  });
});
