import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateMfaEnroll,
  validateMfaLoginVerify,
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

  it('validateMfaLoginVerify accepts mfa_session_token and totp_code', () => {
    expect(
      validateMfaLoginVerify({ mfa_session_token: 'session-token', totp_code: '654321' }),
    ).toEqual({
      mfa_session_token: 'session-token',
      totp_code: '654321',
    });
  });

  it('validateMfaLoginVerify rejects when neither totp_code nor recovery_code is present', () => {
    expect(() => validateMfaLoginVerify({ mfa_session_token: 'session-token' })).toThrow(
      ValidationError,
    );
  });

  it('validateMfaMethodIdParam accepts a valid public id (route-#10)', () => {
    expect(validateMfaMethodIdParam('mfamethodpublicid0001')).toBe('mfamethodpublicid0001');
  });

  it('validateMfaMethodIdParam throws ValidationError for invalid id', () => {
    expect(() => validateMfaMethodIdParam('0')).toThrow(ValidationError);
    expect(() => validateMfaMethodIdParam('abc')).toThrow(ValidationError);
    // route-#10: a bare numeric id is no longer a valid param (now an opaque 21-char public id).
    expect(() => validateMfaMethodIdParam('42')).toThrow(ValidationError);
  });
});
