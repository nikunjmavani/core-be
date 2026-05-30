import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateChangePassword,
  validateCreateAuthMethod,
  validateLogin,
  validateVerifyEmail,
} from '@/domains/auth/auth.validator.js';

describe('auth.validator', () => {
  it('validateLogin accepts valid credentials', () => {
    expect(validateLogin({ email: 'user@example.com', password: 'secret' })).toEqual({
      email: 'user@example.com',
      password: 'secret',
    });
  });

  it('validateLogin throws ValidationError for missing fields', () => {
    expect(() => validateLogin({})).toThrow(ValidationError);
  });

  it('validateLogin rejects unknown extra keys (strict)', () => {
    expect(() =>
      validateLogin({ email: 'user@example.com', password: 'secret', extra: true }),
    ).toThrow(ValidationError);
  });

  it('validateLogin rejects Gmail plus addressing', () => {
    expect(() => validateLogin({ email: 'user+tag@gmail.com', password: 'secret' })).toThrow(
      ValidationError,
    );
  });

  it('validateCreateAuthMethod accepts a canonical method_type', () => {
    expect(validateCreateAuthMethod({ method_type: 'MAGIC_LINK' })).toMatchObject({
      method_type: 'MAGIC_LINK',
      is_primary: false,
    });
  });

  it('validateCreateAuthMethod rejects non-canonical method_type casing', () => {
    expect(() => validateCreateAuthMethod({ method_type: 'oauth' })).toThrow(ValidationError);
  });

  it('validateCreateAuthMethod rejects manual provider identity binding', () => {
    expect(() =>
      validateCreateAuthMethod({
        method_type: 'OAUTH',
        provider: 'google',
        provider_user_id: 'victim-sub',
      }),
    ).toThrow(ValidationError);
  });

  it('validateChangePassword rejects short new password', () => {
    expect(() =>
      validateChangePassword({
        current_password: 'OldPassword12!',
        new_password: 'short',
      }),
    ).toThrow(ValidationError);
  });

  it('validateChangePassword accepts current and new password', () => {
    expect(
      validateChangePassword({
        current_password: 'OldPassword12!',
        new_password: 'NewPassword12!',
      }),
    ).toEqual({
      current_password: 'OldPassword12!',
      new_password: 'NewPassword12!',
    });
  });

  it('validateVerifyEmail accepts token', () => {
    expect(validateVerifyEmail({ token: 'verify-token' })).toEqual({ token: 'verify-token' });
  });
});
