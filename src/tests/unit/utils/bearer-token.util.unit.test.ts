import { describe, it, expect } from 'vitest';
import { isBearerTokenValid } from '@/shared/utils/security/bearer-token.util.js';

describe('bearer-token.util', () => {
  it('returns true for a header with the matching Bearer scheme and token', () => {
    expect(isBearerTokenValid('Bearer s3cret-token', 's3cret-token')).toBe(true);
  });

  it('returns false when the authorization header is missing', () => {
    expect(isBearerTokenValid(undefined, 's3cret-token')).toBe(false);
  });

  it('returns false for an empty authorization header', () => {
    expect(isBearerTokenValid('', 's3cret-token')).toBe(false);
  });

  it('returns false when the scheme is not Bearer', () => {
    expect(isBearerTokenValid('Basic s3cret-token', 's3cret-token')).toBe(false);
  });

  it('returns false when scheme casing differs (case-sensitive)', () => {
    expect(isBearerTokenValid('bearer s3cret-token', 's3cret-token')).toBe(false);
  });

  it('returns false when the token differs from the expected token', () => {
    expect(isBearerTokenValid('Bearer wrong-token', 's3cret-token')).toBe(false);
  });

  it('returns false when only the prefix matches', () => {
    expect(isBearerTokenValid('Bearer ', 's3cret-token')).toBe(false);
  });

  it('returns false when token is appended with trailing characters', () => {
    expect(isBearerTokenValid('Bearer s3cret-token-extra', 's3cret-token')).toBe(false);
  });

  it('returns false when token has leading whitespace before scheme', () => {
    expect(isBearerTokenValid(' Bearer s3cret-token', 's3cret-token')).toBe(false);
  });
});
