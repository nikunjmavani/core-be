import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnvMock = vi.fn();
const originalKubernetesServiceHost = process.env.KUBERNETES_SERVICE_HOST;

vi.mock('@/shared/config/env.config.js', () => ({
  env: new Proxy(
    {},
    {
      get(_target, property) {
        return getEnvMock()[property as string];
      },
    },
  ),
  getEnv: () => getEnvMock(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

async function loadAssertion() {
  const module = await import('@/infrastructure/cache/assert-redis-tls-safety.js');
  return module.assertRedisTlsVerification;
}

describe('assertRedisTlsVerification', () => {
  beforeEach(() => {
    getEnvMock.mockReset();
    vi.resetModules();
    delete process.env.KUBERNETES_SERVICE_HOST;
  });

  afterEach(() => {
    if (originalKubernetesServiceHost === undefined) {
      delete process.env.KUBERNETES_SERVICE_HOST;
    } else {
      process.env.KUBERNETES_SERVICE_HOST = originalKubernetesServiceHost;
    }
  });

  it('throws in a hosted deployment for plaintext redis:// on a public host', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://cache.example.com:6379',
    });
    const assertRedisTlsVerification = await loadAssertion();
    expect(() => assertRedisTlsVerification()).toThrow(/redis\.tls_safety\.unencrypted/);
  });

  it('allows rediss:// (TLS) in a hosted deployment', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://cache.example.com:6379',
    });
    const assertRedisTlsVerification = await loadAssertion();
    expect(() => assertRedisTlsVerification()).not.toThrow();
  });

  it('allows plaintext redis:// on Railway private networking in a hosted deployment', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://core-redis.railway.internal:6379',
    });
    const assertRedisTlsVerification = await loadAssertion();
    expect(() => assertRedisTlsVerification()).not.toThrow();
  });

  it('allows plaintext redis:// to localhost in a hosted deployment', async () => {
    getEnvMock.mockReturnValue({ NODE_ENV: 'production', REDIS_URL: 'redis://localhost:6379' });
    const assertRedisTlsVerification = await loadAssertion();
    expect(() => assertRedisTlsVerification()).not.toThrow();
  });

  it('does not throw on local/test for a plaintext public host (warns only)', async () => {
    getEnvMock.mockReturnValue({ NODE_ENV: 'test', REDIS_URL: 'redis://cache.example.com:6379' });
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const assertRedisTlsVerification = await loadAssertion();
    expect(() => assertRedisTlsVerification()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'REDIS_URL' }),
      expect.stringContaining('redis.tls_safety.unencrypted_local'),
    );
  });

  it('throws for a public REDIS_BULLMQ_URL override over plaintext in hosted', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://core-redis.railway.internal:6379',
      REDIS_BULLMQ_URL: 'redis://bullmq.example.com:6379',
    });
    const assertRedisTlsVerification = await loadAssertion();
    expect(() => assertRedisTlsVerification()).toThrow(/REDIS_BULLMQ_URL/);
  });
});
