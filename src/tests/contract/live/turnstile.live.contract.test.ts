import { describe, expect, test } from 'vitest';
import { env } from '@/shared/config/env.config.js';
import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';
import { hasTurnstileLiveCredentials, describeSkipReason } from './helpers/live-credentials.js';

/**
 * Live Cloudflare Turnstile contract — the real siteverify endpoint.
 *
 * @remarks
 * Cheapest provider to set up: Cloudflare publishes fixed testing secrets, so this needs no account
 * and has no side effects.
 *
 * - `1x0000000000000000000000000000000AA` — always passes
 * - `2x0000000000000000000000000000000AA` — always fails
 * - `3x0000000000000000000000000000000AA` — always yields "challenge already used"
 *
 * Only the secret in `CAPTCHA_SECRET` drives the app's own wrapper, so the cases that need a
 * *different* secret call siteverify directly and assert Cloudflare's raw contract. Those are the
 * upstream half; the wrapper half (hostname guard, error mapping) is asserted through
 * `verifyTurnstileToken`.
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA';
const ALWAYS_FAIL_SECRET = '2x0000000000000000000000000000000AA';
const ALREADY_USED_SECRET = '3x0000000000000000000000000000000AA';

type SiteVerifyResponse = {
  success?: boolean;
  'error-codes'?: string[];
  hostname?: string;
};

async function siteVerify(secret: string, token: string): Promise<SiteVerifyResponse> {
  const response = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }).toString(),
  });
  return (await response.json()) as SiteVerifyResponse;
}

/** Hostnames the verifier will accept, derived exactly as `resolveAllowedTurnstileHostnames` does. */
function allowedHostnames(): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .flatMap((origin) => {
        try {
          return [new URL(origin).hostname.toLowerCase()];
        } catch {
          return [];
        }
      }),
  );
}

describe.skipIf(!hasTurnstileLiveCredentials())('Cloudflare Turnstile LIVE contract', () => {
  // ── The app's wrapper ──────────────────────────────────────────────────

  test('siteverify returns a well-formed verdict envelope', async () => {
    const result = await verifyTurnstileToken({ token: 'XXXX.DUMMY.TOKEN.XXXX' });

    expect(typeof result.success).toBe('boolean');
    if (!result.success) {
      // Cloudflare must say why — a bare `success: false` with no codes is a contract break.
      expect(Array.isArray(result.errorCodes)).toBe(true);
    }
  });

  test('a verdict solved on a foreign property is rejected by the hostname guard', async () => {
    // Cloudflare's testing keys accept any token but report the solving hostname as `example.com`.
    // The audit-#20 guard must not trust that upstream `success: true` unless `example.com` is in
    // ALLOWED_ORIGINS. The expectation is derived, not branched on the result, so removing the
    // guard fails this test.
    const hostnames = allowedHostnames();
    const exampleComIsAllowed = hostnames.size === 0 || hostnames.has('example.com');

    const result = await verifyTurnstileToken({ token: 'definitely-not-a-real-token' });

    expect(result.success).toBe(exampleComIsAllowed);
    if (!exampleComIsAllowed) {
      expect(result.errorCodes ?? []).toContain('hostname-mismatch');
    }
  });

  test('an empty token is refused without reaching a success verdict', async () => {
    const result = await verifyTurnstileToken({ token: '' });

    expect(result.success).toBe(false);
    expect(result.errorCodes ?? []).not.toHaveLength(0);
  });

  test('the optional remoteIp parameter is accepted', async () => {
    // Cloudflare uses remoteIp for risk scoring; a malformed request would come back as an
    // `invalid-input-*` error code rather than a normal verdict.
    const result = await verifyTurnstileToken({
      token: 'XXXX.DUMMY.TOKEN.XXXX',
      remoteIp: '203.0.113.7',
    });

    expect(typeof result.success).toBe('boolean');
    expect(result.errorCodes ?? []).not.toContain('invalid-input-secret');
  });

  // ── Cloudflare's own contract, per testing secret ──────────────────────

  test('the always-pass testing secret returns success upstream', async () => {
    const payload = await siteVerify(ALWAYS_PASS_SECRET, 'any-token-at-all');

    expect(payload.success).toBe(true);
    expect(payload['error-codes'] ?? []).toHaveLength(0);
    // This is the hostname the guard above rejects — assert it, since that behaviour depends on it.
    expect(payload.hostname).toBe('example.com');
  });

  test('the always-fail testing secret returns failure with a reason', async () => {
    const payload = await siteVerify(ALWAYS_FAIL_SECRET, 'any-token-at-all');

    expect(payload.success).toBe(false);
    expect(payload['error-codes'] ?? []).not.toHaveLength(0);
  });

  test('the already-used testing secret reports timeout-or-duplicate', async () => {
    // This is the replay case: a token that has already been redeemed must not verify again.
    const payload = await siteVerify(ALREADY_USED_SECRET, 'any-token-at-all');

    expect(payload.success).toBe(false);
    expect(payload['error-codes'] ?? []).toContain('timeout-or-duplicate');
  });

  test('a malformed secret is reported as invalid-input-secret', async () => {
    const payload = await siteVerify('not-a-real-secret', 'any-token-at-all');

    expect(payload.success).toBe(false);
    expect(payload['error-codes'] ?? []).toContain('invalid-input-secret');
  });

  test('a missing token is reported as missing-input-response', async () => {
    const payload = await siteVerify(ALWAYS_PASS_SECRET, '');

    expect(payload.success).toBe(false);
    expect(payload['error-codes'] ?? []).toContain('missing-input-response');
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
