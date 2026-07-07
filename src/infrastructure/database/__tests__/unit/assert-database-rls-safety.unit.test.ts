import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const getEnvMock = vi.fn();

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
    getEnvMock.mockReturnValue({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'development',
    });
  });

  it('resolves and logs info when the session role is non-superuser without BYPASSRLS', async () => {
    sqlMock.mockResolvedValue([
      { rolname: 'core_be_app_login', rolsuper: false, rolbypassrls: false },
    ]);
    getEnvMock.mockReturnValue({ DATABASE_RLS_SAFETY_ENFORCED: true });

    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/safety/assert-database-rls-safety.js'
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

  it('throws when DATABASE_RLS_SAFETY_ENFORCED and the session role is a superuser', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'postgres', rolsuper: true, rolbypassrls: false }]);
    getEnvMock.mockReturnValue({ DATABASE_RLS_SAFETY_ENFORCED: true });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/safety/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(
      /database\.rls_safety\.unsafe_role/i,
    );
  });

  it('throws when DATABASE_RLS_SAFETY_ENFORCED and the session role has BYPASSRLS', async () => {
    sqlMock.mockResolvedValue([
      { rolname: 'replication_role', rolsuper: false, rolbypassrls: true },
    ]);
    getEnvMock.mockReturnValue({ DATABASE_RLS_SAFETY_ENFORCED: true });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/safety/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(/rolbypassrls=true/);
  });

  it('warns (without throwing) for superuser when DATABASE_RLS_SAFETY_ENFORCED is false', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'postgres', rolsuper: true, rolbypassrls: false }]);
    getEnvMock.mockReturnValue({ DATABASE_RLS_SAFETY_ENFORCED: false });

    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/safety/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rolname: 'postgres', rolsuper: true }),
      expect.stringContaining('database.rls_safety.unsafe_role_local'),
    );
  });

  it('warns (without throwing) for BYPASSRLS when the flag is unset (relaxed)', async () => {
    sqlMock.mockResolvedValue([{ rolname: 'core', rolsuper: false, rolbypassrls: true }]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'development' });

    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/safety/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws when pg_roles returns no row for session_user', async () => {
    sqlMock.mockResolvedValue([]);
    getEnvMock.mockReturnValue({ NODE_ENV: 'development' });

    const { assertDatabaseRoleRlsSafety } = await import(
      '@/infrastructure/database/safety/assert-database-rls-safety.js'
    );

    await expect(assertDatabaseRoleRlsSafety()).rejects.toThrow(
      /database\.rls_safety\.session_role_not_found/,
    );
  });
});
