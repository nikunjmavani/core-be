import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateMfaChallenge,
  validateMfaEnroll,
  validateMfaMethodIdParam,
  validateMfaVerify,
} from '@/domains/auth/auth.validator.js';

describe('mfa.validator', () => {
  it('validateMfaVerify accepts 6-digit code', () => {
    expect(validateMfaVerify({ code: '123456' })).toEqual({ code: '123456' });
  });

  it('validateMfaVerify rejects non-numeric code', () => {
    expect(() => validateMfaVerify({ code: 'abcdef' })).toThrow(ValidationError);
  });

  it('validateMfaEnroll accepts MFA_TOTP', () => {
    expect(validateMfaEnroll({ method_type: 'MFA_TOTP' })).toEqual({ method_type: 'MFA_TOTP' });
  });

  it('validateMfaChallenge accepts user_id and code', () => {
    expect(validateMfaChallenge({ user_id: 'user-1', code: '654321' })).toEqual({
      user_id: 'user-1',
      code: '654321',
    });
  });

  it('validateMfaMethodIdParam accepts positive integer string', () => {
    expect(validateMfaMethodIdParam('42')).toBe(42);
  });

  it('validateMfaMethodIdParam throws ValidationError for invalid id', () => {
    expect(() => validateMfaMethodIdParam('0')).toThrow(ValidationError);
    expect(() => validateMfaMethodIdParam('abc')).toThrow(ValidationError);
  });
});
