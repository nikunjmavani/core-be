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

describe('assertDatabaseTlsVerification', () => {
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

  it('resolves and logs ok when sslmode=verify-full (any environment)', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host/db?sslmode=verify-full',
    });
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );

    expect(() => assertDatabaseTlsVerification()).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sslMode: 'verify-full' }),
      'database.tls_safety.ok',
    );
  });

  it('resolves when DATABASE_SSL_REJECT_UNAUTHORIZED=true even with sslmode=require', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host/db?sslmode=require',
      DATABASE_SSL_REJECT_UNAUTHORIZED: true,
    });
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );
    expect(() => assertDatabaseTlsVerification()).not.toThrow();
  });

  it('throws in production when sslmode=require (encrypted but unverified)', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host/db?sslmode=require',
    });
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );
    expect(() => assertDatabaseTlsVerification()).toThrow(/database\.tls_safety\.unverified/);
  });

  it('throws on hosted Railway deployments (RAILWAY_GIT_COMMIT_SHA set)', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'development',
      RAILWAY_GIT_COMMIT_SHA: 'deadbeef',
      DATABASE_URL: 'postgresql://u:p@host/db?sslmode=require',
    });
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );
    expect(() => assertDatabaseTlsVerification()).toThrow(/database\.tls_safety\.unverified/);
  });

  it('warns (without throwing) on local/dev when verification is off', async () => {
    getEnvMock.mockReturnValue({
      NODE_ENV: 'local',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/core',
    });
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );

    expect(() => assertDatabaseTlsVerification()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sslMode: null }),
      expect.stringContaining('database.tls_safety.unverified_local'),
    );
  });
});
