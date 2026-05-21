import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';

const TURNSTILE_HOST = 'https://challenges.cloudflare.com';

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'test-secret-key';
    resetEnvCacheForTests();
  });

  afterEach(() => {
    nock.cleanAll();
    delete process.env.CAPTCHA_PROVIDER;
    delete process.env.CAPTCHA_SECRET;
    resetEnvCacheForTests();
  });

  it('returns success when Turnstile siteverify succeeds', async () => {
    nock(TURNSTILE_HOST).post('/turnstile/v0/siteverify').reply(200, { success: true });

    const result = await verifyTurnstileToken('valid-token', '127.0.0.1');
    expect(result.success).toBe(true);
  });

  it('returns failure when Turnstile rejects token', async () => {
    nock(TURNSTILE_HOST)
      .post('/turnstile/v0/siteverify')
      .reply(200, { success: false, 'error-codes': ['invalid-input-response'] });

    const result = await verifyTurnstileToken('bad-token');
    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain('invalid-input-response');
  });
});
