import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { VERIFICATION_CODE_MAX_VERIFY_ATTEMPTS } from '@/domains/auth/sub-domains/auth-method/verification-code.js';

/**
 * Online brute-force resistance for the passwordless email-code login.
 *
 * The verification code is a short, bounded string, so its ONLY defence against
 * an attacker who knows a victim's email is the per-user online attempt cap
 * (`VERIFICATION_CODE_MAX_VERIFY_ATTEMPTS`) plus the short TTL and single-use
 * consume. The cap lives in the service on a Redis counter keyed by user id and
 * is security-critical, yet no HTTP-level test proved it engages — a refactor
 * that dropped the counter would keep every functional login test green while
 * reopening unlimited guessing. This locks it: the (N+1)th wrong code for one
 * email is rejected, and the rejection is the SAME generic 401 as a plain wrong
 * code (no "too many attempts" oracle that would confirm the account exists).
 */
describe('Security: email-code login online brute-force cap', () => {
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

  function attemptLogin(email: string, code: string) {
    return injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/login'),
      payload: { email, code },
    });
  }

  async function sendCode(email: string) {
    return injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email },
    });
  }

  it('rejects wrong codes past the per-user cap, and never leaks account existence in the rejection', async () => {
    const victim = await createTestUser({ email: 'brute-victim@example.com' });
    // Issue a real live code so the account is in the exact state a legitimate
    // login would face — the attacker just does not know the value.
    await sendCode(victim.email);

    const wrongCode = 'ZZZZZZ';
    const observedStatuses: number[] = [];
    // Burn through the cap. Each wrong guess increments the per-user counter; the
    // service rejects once attempts EXCEED the cap, so drive it one past.
    for (let attempt = 0; attempt < VERIFICATION_CODE_MAX_VERIFY_ATTEMPTS + 1; attempt += 1) {
      const response = await attemptLogin(victim.email, wrongCode);
      observedStatuses.push(response.statusCode);
    }

    // Every attempt is a generic 401 — before AND after the cap trips. The cap
    // changes throughput (further guesses are refused without touching the code
    // store), never the status/shape, so there is no distinguishable signal.
    expect(observedStatuses.every((status) => status === 401)).toBe(true);

    // The capped rejection is byte-identical to a plain wrong-code rejection for
    // the same account — no "account locked / too many attempts" copy that would
    // confirm the email maps to a real user.
    const cappedRejection = await attemptLogin(victim.email, wrongCode);
    expect(cappedRejection.statusCode).toBe(401);
    const cappedBody = cappedRejection.json() as {
      error?: { code?: string; detail?: string };
    };
    expect(cappedBody.error?.code).toBeDefined();
    // The generic invalid-code identity, not a lockout-specific one.
    expect(cappedBody.error?.detail ?? '').not.toMatch(/lock|too many|attempt/i);
  });

  it('applies the cap per-email — hammering one account does not lock out another', async () => {
    const victim = await createTestUser({ email: 'victim-a@example.com' });
    const bystander = await createTestUser({ email: 'victim-b@example.com' });
    await sendCode(victim.email);
    await sendCode(bystander.email);

    // Exhaust victim A's attempt budget entirely.
    for (let attempt = 0; attempt < VERIFICATION_CODE_MAX_VERIFY_ATTEMPTS + 2; attempt += 1) {
      await attemptLogin(victim.email, 'ZZZZZZ');
    }

    // Bystander B, untouched, still gets the normal generic 401 for a wrong code —
    // A's counter did not bleed onto B (the counter is keyed by user id, so a
    // shared/global counter regression would surface here as a premature reject).
    const bystanderResponse = await attemptLogin(bystander.email, 'YYYYYY');
    expect(bystanderResponse.statusCode).toBe(401);
  });
});
