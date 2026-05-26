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
});
