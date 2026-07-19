import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { captchaPreHandler } from '@/shared/middlewares/security/captcha.middleware.js';

const verifyTurnstileTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/security/turnstile-verifier.util.js', () => ({
  verifyTurnstileToken: verifyTurnstileTokenMock,
}));

function buildRequest(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    ip: '127.0.0.1',
    id: 'req-1',
  } as FastifyRequest;
}

describe('captchaPreHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.CAPTCHA_PROVIDER = 'disabled';
    delete process.env.CAPTCHA_SECRET;
    resetEnvCacheForTests();
  });

  afterEach(() => {
    delete process.env.CAPTCHA_SECRET;
    delete process.env.CAPTCHA_BYPASS_HEADER;
    // Restore the harness defaults (src/tests/setup.ts) so a per-test override cannot leak into
    // sibling tests / files sharing this Vitest worker's process.env.
    process.env.CAPTCHA_PROVIDER = 'disabled';
    process.env.CAPTCHA_FAIL_OPEN = 'true';
    resetEnvCacheForTests();
  });

  it('skips unconditionally when CAPTCHA_PROVIDER=disabled', async () => {
    await expect(captchaPreHandler(buildRequest(), {} as FastifyReply)).resolves.toBeUndefined();
    expect(verifyTurnstileTokenMock).not.toHaveBeenCalled();
  });

  it('CAPTCHA_PROVIDER=disabled skips even when CAPTCHA_FAIL_OPEN=false (one flag, one behaviour)', async () => {
    // Regression: turning captcha off must NOT require a second flag. Before the fix, `disabled`
    // fell into the fail-open/closed branch and threw "captchaProviderUnavailable" with fail-open
    // false — so operators needed both CAPTCHA_PROVIDER=disabled AND CAPTCHA_FAIL_OPEN=true.
    process.env.CAPTCHA_FAIL_OPEN = 'false';
    resetEnvCacheForTests();

    await expect(captchaPreHandler(buildRequest(), {} as FastifyReply)).resolves.toBeUndefined();
    expect(verifyTurnstileTokenMock).not.toHaveBeenCalled();
  });

  it('throws captchaRequired when the token is missing and turnstile is enabled', async () => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'secret';
    resetEnvCacheForTests();

    await expect(captchaPreHandler(buildRequest(), {} as FastifyReply)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('accepts a valid token when turnstile is enabled', async () => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'secret';
    resetEnvCacheForTests();
    verifyTurnstileTokenMock.mockResolvedValue({ success: true });

    await expect(
      captchaPreHandler(buildRequest({ 'x-captcha-token': 'tok' }), {} as FastifyReply),
    ).resolves.toBeUndefined();
    expect(verifyTurnstileTokenMock).toHaveBeenCalledWith({
      token: 'tok',
      remoteIp: '127.0.0.1',
      requestId: 'req-1',
    });
  });

  it('turnstile outage (verify throws) fails CLOSED when CAPTCHA_FAIL_OPEN=false', async () => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'secret';
    process.env.CAPTCHA_FAIL_OPEN = 'false';
    resetEnvCacheForTests();
    verifyTurnstileTokenMock.mockRejectedValue(new Error('turnstile network error'));

    await expect(
      captchaPreHandler(buildRequest({ 'x-captcha-token': 'tok' }), {} as FastifyReply),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('turnstile outage (verify throws) fails OPEN (skips) when CAPTCHA_FAIL_OPEN=true', async () => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'secret';
    process.env.CAPTCHA_FAIL_OPEN = 'true';
    resetEnvCacheForTests();
    verifyTurnstileTokenMock.mockRejectedValue(new Error('turnstile network error'));

    await expect(
      captchaPreHandler(buildRequest({ 'x-captcha-token': 'tok' }), {} as FastifyReply),
    ).resolves.toBeUndefined();
  });
});
