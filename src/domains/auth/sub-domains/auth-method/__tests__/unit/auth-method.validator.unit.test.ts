import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateForgotPassword,
  validateMagicLinkSend,
  validateMagicLinkVerify,
  validateResetPassword,
} from '@/domains/auth/auth.validator.js';

describe('auth-method.validator', () => {
  it('validateMagicLinkSend accepts email', () => {
    expect(validateMagicLinkSend({ email: 'user@example.com' })).toEqual({
      email: 'user@example.com',
    });
  });

  it('validateMagicLinkVerify accepts email + 6-digit code', () => {
    expect(validateMagicLinkVerify({ email: 'user@example.com', code: '123456' })).toEqual({
      email: 'user@example.com',
      code: '123456',
    });
  });

  it('validateMagicLinkVerify rejects a non-6-digit code', () => {
    expect(() => validateMagicLinkVerify({ email: 'user@example.com', code: '12345' })).toThrow(
      ValidationError,
    );
  });

  it('validateForgotPassword accepts email', () => {
    expect(validateForgotPassword({ email: 'user@example.com' })).toEqual({
      email: 'user@example.com',
    });
  });

  it('validateResetPassword accepts token and password', () => {
    expect(validateResetPassword({ token: 'reset-token', password: 'NewPassword12!' })).toEqual({
      token: 'reset-token',
      password: 'NewPassword12!',
    });
  });

  it('validateResetPassword rejects short password', () => {
    expect(() => validateResetPassword({ token: 't', password: 'short' })).toThrow(ValidationError);
  });
});
