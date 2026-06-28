import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateForgotPassword,
  validateEmailSendCode,
  validateEmailLogin,
  validateResetPassword,
} from '@/domains/auth/auth.validator.js';

describe('auth-method.validator', () => {
  it('validateEmailSendCode accepts email', () => {
    expect(validateEmailSendCode({ email: 'user@example.com' })).toEqual({
      email: 'user@example.com',
    });
  });

  it('validateEmailLogin accepts email + 6-char alphanumeric code', () => {
    expect(validateEmailLogin({ email: 'user@example.com', code: 'AB2CD3' })).toEqual({
      email: 'user@example.com',
      code: 'AB2CD3',
    });
  });

  it('validateEmailLogin rejects a non-6-char code', () => {
    expect(() => validateEmailLogin({ email: 'user@example.com', code: 'AB2CD' })).toThrow(
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
