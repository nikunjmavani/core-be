import { describe, it, expect } from 'vitest';
import { validateSignup } from '@/domains/auth/auth.validator.js';
import { ValidationError } from '@/shared/errors/index.js';

describe('validateSignup', () => {
  const valid = { email: 'new.user@example.com', password: 'Str0ng-Pass!word' };

  it('accepts a valid email + policy-compliant password', () => {
    expect(validateSignup(valid)).toMatchObject({
      email: 'new.user@example.com',
      password: 'Str0ng-Pass!word',
    });
  });

  it('accepts optional first_name / last_name', () => {
    const result = validateSignup({ ...valid, first_name: 'Ada', last_name: 'Lovelace' });
    expect(result).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  it('rejects a password shorter than the 12-char minimum', () => {
    expect(() => validateSignup({ ...valid, password: 'Sh0rt!' })).toThrow(ValidationError);
  });

  it('rejects a password with fewer than 3 character classes', () => {
    expect(() => validateSignup({ ...valid, password: 'alllowercaseletters' })).toThrow(
      ValidationError,
    );
  });

  it('rejects an invalid email', () => {
    expect(() => validateSignup({ ...valid, email: 'not-an-email' })).toThrow(ValidationError);
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(() => validateSignup({ ...valid, is_admin: true })).toThrow(ValidationError);
  });

  it('rejects a missing password', () => {
    expect(() => validateSignup({ email: valid.email })).toThrow(ValidationError);
  });
});
