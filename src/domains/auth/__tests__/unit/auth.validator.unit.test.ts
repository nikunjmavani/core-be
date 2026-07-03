import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateChangePassword,
  validateCreateAuthMethod,
  validateLogin,
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
    expect(validateCreateAuthMethod({ method_type: 'EMAIL_CODE' })).toMatchObject({
      method_type: 'EMAIL_CODE',
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

  // route-#3: only EMAIL_CODE is a functional credential-less row; PASSWORD/MFA_*/OAUTH would be
  // non-functional phantom rows that defeat the last-login-capable-credential guard.
  it.each([
    'PASSWORD',
    'OAUTH',
    'MFA_TOTP',
    'MFA_SMS',
    'MFA_EMAIL',
  ])('validateCreateAuthMethod rejects credential-bearing type %s (phantom-row lockout)', (methodType) => {
    expect(() => validateCreateAuthMethod({ method_type: methodType })).toThrow(ValidationError);
  });

  it('validateCreateAuthMethod accepts EMAIL_CODE (the only valid bare-row type)', () => {
    expect(validateCreateAuthMethod({ method_type: 'EMAIL_CODE' })).toMatchObject({
      method_type: 'EMAIL_CODE',
    });
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

  it('validateChangePassword rejects a long password lacking character-class diversity (EX-10)', () => {
    // 19 chars but a single character class (all lowercase) — meets length, fails the policy.
    expect(() =>
      validateChangePassword({
        current_password: 'OldPassword12!',
        new_password: 'alllowercaseletters',
      }),
    ).toThrow(ValidationError);
  });

  it('validateChangePassword accepts a 12-char password with 3 character classes (EX-10)', () => {
    // lowercase + uppercase + digit = 3 of 4 classes, no symbol required.
    expect(
      validateChangePassword({
        current_password: 'OldPassword12!',
        new_password: 'lowerUPPER12',
      }),
    ).toEqual({
      current_password: 'OldPassword12!',
      new_password: 'lowerUPPER12',
    });
  });
});
