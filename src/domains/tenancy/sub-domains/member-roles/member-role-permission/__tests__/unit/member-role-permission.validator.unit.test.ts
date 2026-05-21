import { describe, expect, it } from 'vitest';
import { validatePutMemberRolePermissions } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.validator.js';

describe('member-role-permission validators', () => {
  it('validatePutMemberRolePermissions accepts permission_codes array', () => {
    expect(validatePutMemberRolePermissions({ permission_codes: ['user:read'] })).toEqual({
      permission_codes: ['user:read'],
    });
  });

  it('validatePutMemberRolePermissions accepts empty array', () => {
    expect(validatePutMemberRolePermissions({ permission_codes: [] })).toEqual({
      permission_codes: [],
    });
  });
});
