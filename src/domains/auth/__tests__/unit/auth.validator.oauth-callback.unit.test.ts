import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateOauthCallbackQuery } from '@/domains/auth/auth.validator.js';

describe('validateOauthCallbackQuery', () => {
  it('accepts code and state', () => {
    expect(validateOauthCallbackQuery({ code: 'auth-code', state: 'oauth-state' })).toEqual({
      code: 'auth-code',
      state: 'oauth-state',
    });
  });

  it('requires code', () => {
    expect(() => validateOauthCallbackQuery({ state: 'only-state' })).toThrow(ValidationError);
  });

  it('requires state', () => {
    expect(() => validateOauthCallbackQuery({ code: 'auth-code' })).toThrow(ValidationError);
  });

  it('rejects unknown query keys', () => {
    expect(() =>
      validateOauthCallbackQuery({ code: 'auth-code', state: 'oauth-state', extra: 'x' }),
    ).toThrow(ValidationError);
  });
});
