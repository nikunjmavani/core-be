import { describe, expect, it } from 'vitest';
import { validatePutMemberRolePermissions } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.validator.js';
import { ValidationError } from '@/shared/errors/index.js';

describe('member-role-permission.validator edge cases', () => {
  it('rejects unknown root keys (strict)', () => {
    expect(() =>
      validatePutMemberRolePermissions({
        permission_codes: ['user:read'],
        unknown_field: 'oops',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts an empty permission_codes array (business allows clearing permissions)', () => {
    expect(validatePutMemberRolePermissions({ permission_codes: [] })).toEqual({
      permission_codes: [],
    });
  });

  it('rejects payloads missing permission_codes', () => {
    expect(() => validatePutMemberRolePermissions({})).toThrow(ValidationError);
  });

  it('rejects non-string entries inside permission_codes', () => {
    expect(() => validatePutMemberRolePermissions({ permission_codes: ['user:read', 42] })).toThrow(
      ValidationError,
    );
  });
});
