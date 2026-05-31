import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';

const mockEnv = vi.hoisted(() => ({
  GLOBAL_ADMIN_EMAILS: undefined as string | undefined,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  resolveAccessTokenRoleForUser,
  resolveGlobalRoleForEmail,
} from '@/shared/utils/auth/global-admin-role.util.js';

describe('global-admin-role.util', () => {
  afterEach(() => {
    mockEnv.GLOBAL_ADMIN_EMAILS = undefined;
  });

  it('resolveGlobalRoleForEmail returns super_admin for allowlisted email', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = 'Admin@Example.com, other@example.com';
    expect(resolveGlobalRoleForEmail('admin@example.com')).toBe(GLOBAL_ROLES.SUPER_ADMIN);
    expect(resolveGlobalRoleForEmail('other@example.com')).toBe(GLOBAL_ROLES.SUPER_ADMIN);
  });

  it('resolveGlobalRoleForEmail returns undefined when email is not allowlisted', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = 'admin@example.com';
    expect(resolveGlobalRoleForEmail('user@example.com')).toBeUndefined();
  });

  it('resolveGlobalRoleForEmail returns undefined when allowlist is empty', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = '';
    expect(resolveGlobalRoleForEmail('admin@example.com')).toBeUndefined();
  });

  it('resolveAccessTokenRoleForUser elevates allowlisted ACTIVE + verified email to super_admin', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = 'admin@example.com';
    expect(
      resolveAccessTokenRoleForUser({
        email: 'admin@example.com',
        status: 'ACTIVE',
        isEmailVerified: true,
      }),
    ).toBe(GLOBAL_ROLES.SUPER_ADMIN);
  });

  it('resolveAccessTokenRoleForUser denies global-admin override when email is not verified', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = 'admin@example.com';
    expect(
      resolveAccessTokenRoleForUser({
        email: 'admin@example.com',
        status: 'ACTIVE',
        isEmailVerified: false,
      }),
    ).toBe(GLOBAL_ROLES.USER);
  });

  it('resolveAccessTokenRoleForUser denies global-admin override when account is not ACTIVE', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = 'admin@example.com';
    expect(
      resolveAccessTokenRoleForUser({
        email: 'admin@example.com',
        status: 'SUSPENDED',
        isEmailVerified: true,
      }),
    ).toBeUndefined();
  });

  it('resolveAccessTokenRoleForUser returns user for ACTIVE non-admin', () => {
    expect(
      resolveAccessTokenRoleForUser({
        email: 'user@example.com',
        status: 'ACTIVE',
        isEmailVerified: true,
      }),
    ).toBe(GLOBAL_ROLES.USER);
  });

  it('resolveAccessTokenRoleForUser returns undefined for non-ACTIVE non-admin', () => {
    expect(
      resolveAccessTokenRoleForUser({
        email: 'user@example.com',
        status: 'SUSPENDED',
        isEmailVerified: true,
      }),
    ).toBeUndefined();
  });
});
