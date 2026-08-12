import { describe, expect, test } from 'vitest';
import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';
import { hasTurnstileLiveCredentials, describeSkipReason } from './helpers/live-credentials.js';

/**
 * Live Cloudflare Turnstile contract — calls the real siteverify endpoint.
 *
 * Cheapest provider to set up: Cloudflare publishes fixed testing secrets, so this needs no
 * account and has no side effects. Which assertion holds depends on which testing secret is
 * configured, so the spec asserts the envelope shape and reports the verdict rather than
 * hardcoding one outcome:
 *
 * - `1x0000000000000000000000000000000AA` — always passes
 * - `2x0000000000000000000000000000000AA` — always fails
 * - `3x0000000000000000000000000000000AA` — always yields a "challenge already used" error
 */
describe.skipIf(!hasTurnstileLiveCredentials())('Cloudflare Turnstile LIVE contract', () => {
  test('siteverify returns a well-formed verdict envelope', async () => {
    const result = await verifyTurnstileToken({ token: 'XXXX.DUMMY.TOKEN.XXXX' });

    expect(typeof result.success).toBe('boolean');
    if (!result.success) {
      // Cloudflare must say why — a bare `success: false` with no codes is a contract break.
      expect(Array.isArray(result.errorCodes)).toBe(true);
    }
  });

  test('an obviously invalid token is never accepted', async () => {
    // Fail-closed check against the real endpoint: whatever the configured secret, a garbage
    // token must not verify unless the always-pass testing secret is in use.
    const result = await verifyTurnstileToken({ token: 'definitely-not-a-real-token' });
    const usingAlwaysPassSecret = process.env.CAPTCHA_SECRET?.startsWith('1x') === true;

    expect(result.success).toBe(usingAlwaysPassSecret);
  });
});

describe.skipIf(hasTurnstileLiveCredentials())(
  'Cloudflare Turnstile LIVE contract — skipped',
  () => {
    test('reports why it did not run', () => {
      expect(describeSkipReason('turnstile')).toContain('turnstile');
    });
  },
);
