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

  // The callback query string is authored by the identity provider, not by us. Google appends
  // iss/scope/authuser/hd/prompt to EVERY callback with no way to suppress them, so rejecting
  // unknown keys rejected Google's own protocol response and made sign-in impossible.
  it('accepts a realistic Google callback with its extra params', () => {
    const parsed = validateOauthCallbackQuery({
      state: 'e7f92bc44dbb265b9dceb34528bda889b7b98a4f71461bf9bd49d5ec6016dfe2',
      code: '4/0AVMBsJi-probe-authorization-code',
      scope: 'email profile openid',
      authuser: '0',
      prompt: 'consent',
      iss: 'https://accounts.google.com',
      hd: 'albetrios.com',
    });
    expect(parsed.code).toBe('4/0AVMBsJi-probe-authorization-code');
    expect(parsed.state).toBe('e7f92bc44dbb265b9dceb34528bda889b7b98a4f71461bf9bd49d5ec6016dfe2');
  });

  it('tolerates a param no provider has sent yet', () => {
    expect(() =>
      validateOauthCallbackQuery({ code: 'auth-code', state: 'oauth-state', future_param: 'x' }),
    ).not.toThrow();
  });
});
