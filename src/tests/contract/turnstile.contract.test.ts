import { describe, expect, test, vi } from 'vitest';
import nock from 'nock';

// The verifier reads CAPTCHA_SECRET via getEnv() which validates the
// full env schema on first call. .env.development sets
// CAPTCHA_PROVIDER=disabled / CAPTCHA_SECRET= , so we mock the env
// accessor for this contract suite to pin a non-empty secret without
// mutating the real config.
vi.mock('@/shared/config/env.config.js', async () => {
  const actual = (await vi.importActual<typeof import('@/shared/config/env.config.js')>(
    '@/shared/config/env.config.js',
  )) as typeof import('@/shared/config/env.config.js');
  const envWithCaptcha = {
    ...actual.env,
    CAPTCHA_PROVIDER: 'turnstile',
    CAPTCHA_SECRET: 'test-turnstile-secret',
    // audit #20: pin an allowlist so the hostname-mismatch assertions are deterministic.
    ALLOWED_ORIGINS: 'https://app.example.com',
  };
  return {
    ...actual,
    env: envWithCaptcha,
    getEnv: () => envWithCaptcha,
  };
});

import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';

registerThirdPartyContractTestIsolationHooks();

/**
 * Contract test for Cloudflare Turnstile siteverify (sec-r5-tc-2).
 *
 * The captcha middleware relies on `verifyTurnstileToken` to call
 * `https://challenges.cloudflare.com/turnstile/v0/siteverify` with a
 * `application/x-www-form-urlencoded` body containing `secret`, `response`,
 * and optionally `remoteip`. Cloudflare responds with JSON
 * `{ success: boolean, "error-codes"?: string[] }`. Parity with the existing
 * Stripe / Resend / S3 contract suites — without these, a Cloudflare-side
 * surface change (header name, body shape, response schema) ships green to
 * production and only surfaces in user-facing flows.
 */
describe('Cloudflare Turnstile siteverify contract', () => {
  const SITEVERIFY_HOSTNAME = 'https://challenges.cloudflare.com';
  const SITEVERIFY_PATH = '/turnstile/v0/siteverify';

  test('POSTs application/x-www-form-urlencoded with secret + response fields', async () => {
    // nock parses the form body into a plain object when the request carries
    // application/x-www-form-urlencoded — so we assert on the parsed shape
    // rather than the raw string.
    let capturedBody: Record<string, string> | undefined;
    let capturedContentType: string | undefined;

    nock(SITEVERIFY_HOSTNAME)
      .post(SITEVERIFY_PATH, (body) => {
        capturedBody =
          typeof body === 'object' && body !== null ? (body as Record<string, string>) : undefined;
        return true;
      })
      .matchHeader('content-type', (value) => {
        capturedContentType = String(value);
        return /application\/x-www-form-urlencoded/i.test(String(value));
      })
      .reply(200, { success: true });

    const result = await verifyTurnstileToken({
      token: 'turnstile-response-token-from-client',
      remoteIp: '198.51.100.42',
    });

    expect(result.success).toBe(true);
    expect(result.errorCodes).toBeUndefined();
    expect(capturedContentType).toMatch(/application\/x-www-form-urlencoded/i);
    expect(capturedBody).toBeDefined();
    expect(capturedBody!.secret).toBe('test-turnstile-secret');
    expect(capturedBody!.response).toBe('turnstile-response-token-from-client');
    expect(capturedBody!.remoteip).toBe('198.51.100.42');
  });

  test('Cloudflare `success: false` with error-codes is surfaced to the caller', async () => {
    nock(SITEVERIFY_HOSTNAME)
      .post(SITEVERIFY_PATH)
      .reply(200, {
        success: false,
        'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
      });

    const result = await verifyTurnstileToken({
      token: 'expired-or-replayed-token',
    });

    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(['invalid-input-response', 'timeout-or-duplicate']);
  });

  // audit #20: a token solved on another property must not be replayable here.
  test('rejects a success response whose hostname is outside ALLOWED_ORIGINS', async () => {
    nock(SITEVERIFY_HOSTNAME)
      .post(SITEVERIFY_PATH)
      .reply(200, { success: true, hostname: 'attacker.evil.example' });

    const result = await verifyTurnstileToken({ token: 'farmed-token-from-another-site' });

    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(['hostname-mismatch']);
  });

  test('accepts a success response whose hostname is in ALLOWED_ORIGINS', async () => {
    nock(SITEVERIFY_HOSTNAME)
      .post(SITEVERIFY_PATH)
      .reply(200, { success: true, hostname: 'app.example.com' });

    const result = await verifyTurnstileToken({ token: 'legit-token' });

    expect(result.success).toBe(true);
    expect(result.errorCodes).toBeUndefined();
  });

  test('Cloudflare missing `success` field is treated as failure (strict === true check)', async () => {
    // sec-r5-tc-2: the verifier uses `payload.success === true` so any response
    // shape Cloudflare changes underneath (e.g. dropping the field, returning
    // a non-boolean value, returning a different success indicator) must fail
    // closed — the captcha middleware throws UnauthorizedError downstream.
    nock(SITEVERIFY_HOSTNAME)
      .post(SITEVERIFY_PATH)
      .reply(200, { /* no `success` field */ 'error-codes': [] });

    const result = await verifyTurnstileToken({ token: 'malformed-response' });

    expect(result.success).toBe(false);
  });

  test('Cloudflare success: "true" (string) is rejected — must be boolean true (fail-closed)', async () => {
    // Belt-and-suspenders: a Cloudflare-side regression that emits a string
    // instead of a boolean must not be silently accepted as truthy.
    nock(SITEVERIFY_HOSTNAME).post(SITEVERIFY_PATH).reply(200, { success: 'true' });

    const result = await verifyTurnstileToken({ token: 'string-success' });

    expect(result.success).toBe(false);
  });

  test('remoteIp omitted when not supplied (no stray field in body)', async () => {
    let capturedBody: Record<string, string> | undefined;

    nock(SITEVERIFY_HOSTNAME)
      .post(SITEVERIFY_PATH, (body) => {
        capturedBody =
          typeof body === 'object' && body !== null ? (body as Record<string, string>) : undefined;
        return true;
      })
      .reply(200, { success: true });

    await verifyTurnstileToken({ token: 'token-no-ip' });

    expect(capturedBody).toBeDefined();
    expect(capturedBody!.remoteip).toBeUndefined();
  });
});
