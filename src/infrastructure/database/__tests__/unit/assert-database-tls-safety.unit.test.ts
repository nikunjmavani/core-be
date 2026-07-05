import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEnvMock = vi.fn();

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
  });

  it('resolves and logs ok when sslmode=verify-full (regardless of the enforcement flag)', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_TLS_ENFORCED: true,
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
      DATABASE_TLS_ENFORCED: true,
      DATABASE_URL: 'postgresql://u:p@host/db?sslmode=require',
      DATABASE_SSL_REJECT_UNAUTHORIZED: true,
    });
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );
    expect(() => assertDatabaseTlsVerification()).not.toThrow();
  });

  it('throws when DATABASE_TLS_ENFORCED and sslmode=require (encrypted but unverified)', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_TLS_ENFORCED: true,
      DATABASE_URL: 'postgresql://u:p@host/db?sslmode=require',
    });
    const { assertDatabaseTlsVerification } = await import(
      '@/infrastructure/database/safety/assert-database-tls-safety.js'
    );
    expect(() => assertDatabaseTlsVerification()).toThrow(/database\.tls_safety\.unverified/);
  });

  it('warns (without throwing) when DATABASE_TLS_ENFORCED is false and verification is off', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_TLS_ENFORCED: false,
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
