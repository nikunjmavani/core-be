import { afterEach, describe, expect, it, vi } from 'vitest';

describe('rate-limit-presets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('STRICT_PUBLIC_RATE_LIMIT allows 5000 req/min in test NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { STRICT_PUBLIC_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_RATE_LIMIT.config.rateLimit.max).toBe(5000);
  });

  it('STRICT_PUBLIC_RATE_LIMIT caps public auth routes at 5 req/min outside test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_RATE_LIMIT.config.rateLimit.max).toBe(5);
    expect(STRICT_PUBLIC_RATE_LIMIT.config.rateLimit.timeWindow).toBe(60_000);
  });

  it('STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS caps per email at 5 / 15 min on preHandler outside test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.max).toBe(5);
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.timeWindow).toBe(15 * 60_000);
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.hook).toBe('preHandler');
  });

  it('STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS lifts the cap under test NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.max).toBe(5000);
  });

  it('per-email key generator normalizes the body email (trim + lowercase) and ignores IP', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    const keyGenerator = STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.keyGenerator;
    expect(keyGenerator).toBeDefined();
    const key = await keyGenerator?.({
      ip: '203.0.113.7',
      body: { email: '  USER@Example.COM ' },
    } as never);
    expect(key).toBe('email:user@example.com');
  });

  it('per-email key generator falls back to IP when the body has no usable email', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    const keyGenerator = STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.keyGenerator;
    const key = await keyGenerator?.({ ip: '203.0.113.7', body: {} } as never);
    expect(key).toBe('ip:203.0.113.7');
  });
});
