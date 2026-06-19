import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { verification_tokens } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.schema.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';

/**
 * End-to-end wiring proof for the password-strength gate on the public reset route. The change
 * route is symmetric but sits behind a recent-step-up pre-handler, so its wiring is proven at the
 * service level in `auth-method.change-password.strength.db.unit.test.ts`. HIBP stays off here so
 * no outbound call is made (the breach path is covered by the HIBP contract test).
 */
async function seedPasswordResetToken(): Promise<string> {
  const { user } = await createTestUserWithPassword({ password: 'SeedCurrent!9xKqWz2' });
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  await database.insert(verification_tokens).values({
    token_type: 'PASSWORD_RESET',
    token_hash: tokenHash,
    user_id: user.id,
    email: user.email,
    expires_at: new Date(Date.now() + 3_600_000),
  });
  return rawToken;
}

describe('Password strength enforcement — reset flow (HTTP)', () => {
  let app: FastifyInstance;
  const previousStrength = process.env.PASSWORD_STRENGTH_CHECK_ENABLED;
  const previousHibp = process.env.PASSWORD_HIBP_CHECK_ENABLED;

  beforeAll(async () => {
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = 'true';
    process.env.PASSWORD_HIBP_CHECK_ENABLED = 'false';
    resetEnvCacheForTests();
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = previousStrength ?? 'false';
    process.env.PASSWORD_HIBP_CHECK_ENABLED = previousHibp ?? 'false';
    resetEnvCacheForTests();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('rejects a weak new password with 400 and a `password` field error', async () => {
    const rawToken = await seedPasswordResetToken();
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/password/reset'),
      payload: { token: rawToken, password: 'aaaaaaaaaaaaaa' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error?: { code?: string; errors?: { field?: string }[] };
    };
    expect(body.error?.code).toBe('invalid_field');
    expect(body.error?.errors?.some((entry) => entry.field === 'password')).toBe(true);
  });

  it('accepts a strong new password (reset succeeds)', async () => {
    const rawToken = await seedPasswordResetToken();
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/password/reset'),
      payload: { token: rawToken, password: '9vZ!q4Xr72$KmLw8Tn3p' },
    });

    expect(response.statusCode).toBeLessThan(400);
  });
});
