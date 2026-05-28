import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';

const mockEnv = vi.hoisted(() => ({
  GLOBAL_ADMIN_EMAILS: undefined as string | undefined,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
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

  it('resolveAccessTokenRoleForUser prefers global admin over ACTIVE user role', () => {
    mockEnv.GLOBAL_ADMIN_EMAILS = 'admin@example.com';
    expect(resolveAccessTokenRoleForUser('admin@example.com', 'ACTIVE')).toBe(
      GLOBAL_ROLES.SUPER_ADMIN,
    );
  });

  it('resolveAccessTokenRoleForUser returns user for ACTIVE non-admin', () => {
    expect(resolveAccessTokenRoleForUser('user@example.com', 'ACTIVE')).toBe(GLOBAL_ROLES.USER);
  });

  it('resolveAccessTokenRoleForUser returns undefined for non-ACTIVE non-admin', () => {
    expect(resolveAccessTokenRoleForUser('user@example.com', 'SUSPENDED')).toBeUndefined();
  });
});
