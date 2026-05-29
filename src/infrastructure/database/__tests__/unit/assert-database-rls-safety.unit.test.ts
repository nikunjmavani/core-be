import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const getEnvMock = vi.fn();
const originalKubernetesServiceHost = process.env.KUBERNETES_SERVICE_HOST;

vi.mock('@/infrastructure/database/connection.js', () => ({
  sql: (...arguments_: unknown[]) => sqlMock(...arguments_),
}));

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

describe('assertDatabaseRoleRlsSafety', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    getEnvMock.mockReset();
    vi.resetModules();
    delete process.env.KUBERNETES_SERVICE_HOST;
    getEnvMock.mockReturnValue({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    });
  });

  afterEach(() => {
    if (originalKubernetesServiceHost === undefined) {
      delete process.env.KUBERNETES_SERVICE_HOST;
    } else {
      process.env.KUBERNETES_SERVICE_HOST = originalKubernetesServiceHost;
    }
  });

  it('resolves and logs info when the session role is non-superuser without BYPASSRLS', async () => {
    sqlMock.mockResolvedValue([
      { rolname: 'core_be_app_login', rolsuper: false, rolbypassrls: false },
    ]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'production' });

    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        rolname: 'core_be_app_login',
        rolsuper: false,
        rolbypassrls: false,
      }),
      'database.rls_safety.ok',
    );
  });

  it('throws in production when the session role is a superuser', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'postgres', rolsuper: true, rolbypassrls: false }]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'production' });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(
      /database\.rls_safety\.unsafe_role/i,
    );
  });

  it('throws in production when the session role has BYPASSRLS', async () => {
    sqlMock.mockResolvedValue([
      { rolname: 'replication_role', rolsuper: false, rolbypassrls: true },
    ]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'production' });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(/rolbypassrls=true/);
  });

  it('throws on hosted Railway deployments (RAILWAY_GIT_COMMIT_SHA set, NODE_ENV=development)', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'postgres', rolsuper: true, rolbypassrls: false }]);
    getEnvMock.mockReturnValue({
      NODE_ENV: 'development',
      RAILWAY_GIT_COMMIT_SHA: 'deadbeef',
    });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(
      /database\.rls_safety\.unsafe_role/,
    );
  });

  it('throws on hosted Kubernetes deployments (KUBERNETES_SERVICE_HOST set)', async () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    sqlMock.mockResolvedValue([{ rolname: 'app_role', rolsuper: false, rolbypassrls: true }]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'staging' });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(
      /database\.rls_safety\.unsafe_role/,
    );
  });

  it('warns (without throwing) for superuser on local/dev when no hosted markers are set', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'postgres', rolsuper: true, rolbypassrls: false }]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'local' });

    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rolname: 'postgres', rolsuper: true }),
      expect.stringContaining('database.rls_safety.unsafe_role_local'),
    );
  });

  it('warns (without throwing) for BYPASSRLS on test environment', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'core', rolsuper: false, rolbypassrls: true }]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'test' });

    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws when pg_roles returns no row for session_user', async () => {
    sqlMock.mockResolvedValue([]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'test' });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(
      /database\.rls_safety\.session_role_not_found/,
    );
  });
});
