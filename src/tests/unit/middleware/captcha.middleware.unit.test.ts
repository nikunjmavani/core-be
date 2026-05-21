import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { captchaPreHandler } from '@/shared/middlewares/captcha.middleware.js';

const verifyTurnstileTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/security/turnstile-verifier.util.js', () => ({
  verifyTurnstileToken: verifyTurnstileTokenMock,
}));

function buildRequest(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    ip: '127.0.0.1',
  } as FastifyRequest;
}

describe('captchaPreHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.CAPTCHA_PROVIDER = 'disabled';
    delete process.env.CAPTCHA_SECRET;
    resetEnvCacheForTests();
  });

  afterEach(() => {
    delete process.env.CAPTCHA_PROVIDER;
    delete process.env.CAPTCHA_SECRET;
    delete process.env.CAPTCHA_BYPASS_HEADER;
    resetEnvCacheForTests();
  });

  it('skips verification when CAPTCHA is disabled in test', async () => {
    await expect(captchaPreHandler(buildRequest(), {} as FastifyReply)).resolves.toBeUndefined();
    expect(verifyTurnstileTokenMock).not.toHaveBeenCalled();
  });

  it('throws captchaRequired when token missing and provider enabled', async () => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'secret';
    resetEnvCacheForTests();

    await expect(captchaPreHandler(buildRequest(), {} as FastifyReply)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('accepts valid token when provider enabled', async () => {
    process.env.CAPTCHA_PROVIDER = 'turnstile';
    process.env.CAPTCHA_SECRET = 'secret';
    resetEnvCacheForTests();
    verifyTurnstileTokenMock.mockResolvedValue({ success: true });

    await expect(
      captchaPreHandler(buildRequest({ 'x-captcha-token': 'tok' }), {} as FastifyReply),
    ).resolves.toBeUndefined();
    expect(verifyTurnstileTokenMock).toHaveBeenCalledWith('tok', '127.0.0.1');
  });
});
