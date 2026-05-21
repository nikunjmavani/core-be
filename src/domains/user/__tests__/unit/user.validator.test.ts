import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateAdminUpdateUser,
  validateListUsers,
  validateUpdateMe,
  validateUploadAvatar,
} from '@/domains/user/user.validator.js';

describe('user.validator', () => {
  it('validateUpdateMe accepts partial profile fields', () => {
    expect(validateUpdateMe({ first_name: 'Jane' })).toEqual({ first_name: 'Jane' });
  });

  it('validateUpdateMe rejects avatar_url (use avatarKey via upload flow)', () => {
    expect(() => validateUpdateMe({ avatar_url: 'https://example.com/a.png' })).toThrow(
      ValidationError,
    );
  });

  it('validateUpdateMe rejects avatarKey without avatars/ prefix', () => {
    expect(() => validateUpdateMe({ avatarKey: 'uploads/photo.png' })).toThrow(ValidationError);
  });

  it('validateListUsers applies pagination defaults', () => {
    expect(validateListUsers({})).toMatchObject({ limit: 25 });
  });

  it('validateAdminUpdateUser accepts status', () => {
    expect(validateAdminUpdateUser({ status: 'SUSPENDED' })).toEqual({ status: 'SUSPENDED' });
  });

  it('validateListUsers rejects invalid status filter', () => {
    expect(() => validateListUsers({ status: 'INVALID' })).toThrow(ValidationError);
  });

  it('validateUpdateMe rejects strict unknown keys', () => {
    expect(() => validateUpdateMe({ first_name: 'Jane', unknown: true })).toThrow(ValidationError);
  });

  it('validateUploadAvatar accepts avatarKey with avatars/ prefix', () => {
    expect(validateUploadAvatar({ avatarKey: 'avatars/user-1/photo.png' })).toEqual({
      avatarKey: 'avatars/user-1/photo.png',
    });
  });

  it('validateUploadAvatar rejects missing avatarKey', () => {
    expect(() => validateUploadAvatar({})).toThrow(ValidationError);
  });

  it('validateUploadAvatar rejects avatarKey without avatars/ prefix', () => {
    expect(() => validateUploadAvatar({ avatarKey: 'uploads/photo.png' })).toThrow(ValidationError);
  });

  it('validateUploadAvatar rejects strict unknown keys', () => {
    expect(() =>
      validateUploadAvatar({ avatarKey: 'avatars/user-1/photo.png', extra: true }),
    ).toThrow(ValidationError);
  });
});
