import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateWebauthnAuthenticateOptions,
  validateWebauthnRegisterVerify,
  validateWebauthnAuthenticateVerify,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn.validator.js';

describe('webauthn.validator', () => {
  describe('validateWebauthnAuthenticateOptions', () => {
    it('accepts a valid email and returns parsed data', () => {
      const result = validateWebauthnAuthenticateOptions({ email: 'user@example.com' });
      expect(result).toEqual({ email: 'user@example.com' });
    });

    it('accepts an empty body (email is optional)', () => {
      const result = validateWebauthnAuthenticateOptions({});
      expect(result).toEqual({});
    });

    it('accepts undefined body as empty object (email is optional)', () => {
      const result = validateWebauthnAuthenticateOptions(undefined);
      expect(result).toEqual({});
    });

    it('throws ValidationError for empty string email', () => {
      expect(() => validateWebauthnAuthenticateOptions({ email: '' })).toThrow(ValidationError);
    });

    it('throws ValidationError for invalid email format "notanemail"', () => {
      expect(() => validateWebauthnAuthenticateOptions({ email: 'notanemail' })).toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError for email missing TLD', () => {
      expect(() => validateWebauthnAuthenticateOptions({ email: 'user@domain' })).toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError for unknown extra fields (strict mode)', () => {
      expect(() =>
        validateWebauthnAuthenticateOptions({ email: 'user@example.com', extra: true }),
      ).toThrow(ValidationError);
    });
  });

  describe('validateWebauthnRegisterVerify', () => {
    const minToken = 'a'.repeat(64);
    const maxToken = 'b'.repeat(128);
    const validResponse = { clientDataJSON: 'data', attestationObject: 'obj' };

    it('accepts challenge_token exactly 64 chars (min boundary) with valid response', () => {
      const result = validateWebauthnRegisterVerify({
        challenge_token: minToken,
        response: validResponse,
      });
      expect(result.challenge_token).toBe(minToken);
      expect(result.response).toEqual(validResponse);
    });

    it('accepts challenge_token exactly 128 chars (max boundary)', () => {
      const result = validateWebauthnRegisterVerify({
        challenge_token: maxToken,
        response: validResponse,
      });
      expect(result.challenge_token).toBe(maxToken);
    });

    it('throws ValidationError for challenge_token 63 chars (min-1 boundary)', () => {
      expect(() =>
        validateWebauthnRegisterVerify({
          challenge_token: 'a'.repeat(63),
          response: validResponse,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError for challenge_token 129 chars (max+1 boundary)', () => {
      expect(() =>
        validateWebauthnRegisterVerify({
          challenge_token: 'a'.repeat(129),
          response: validResponse,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError when challenge_token is missing', () => {
      expect(() =>
        validateWebauthnRegisterVerify({
          response: validResponse,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError when response field is missing', () => {
      expect(() =>
        validateWebauthnRegisterVerify({
          challenge_token: minToken,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError for extra unknown field (strict mode)', () => {
      expect(() =>
        validateWebauthnRegisterVerify({
          challenge_token: minToken,
          response: validResponse,
          extra_field: 'should-fail',
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('validateWebauthnAuthenticateVerify', () => {
    const validToken = 'c'.repeat(64);
    const validCredential = {
      id: 'credential-id',
      rawId: 'raw-id',
      response: { clientDataJSON: 'data', authenticatorData: 'auth', signature: 'sig' },
      type: 'public-key',
    };

    it('accepts a valid complete input and returns parsed data', () => {
      const result = validateWebauthnAuthenticateVerify({
        challenge_token: validToken,
        response: validCredential,
      });
      expect(result.challenge_token).toBe(validToken);
      expect(result.response).toEqual(validCredential);
    });

    it('throws ValidationError when challenge_token is missing', () => {
      expect(() =>
        validateWebauthnAuthenticateVerify({
          response: validCredential,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError when response field is missing', () => {
      expect(() =>
        validateWebauthnAuthenticateVerify({
          challenge_token: validToken,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError for challenge_token below minimum length', () => {
      expect(() =>
        validateWebauthnAuthenticateVerify({
          challenge_token: 'short',
          response: validCredential,
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError for extra unknown fields (strict mode)', () => {
      expect(() =>
        validateWebauthnAuthenticateVerify({
          challenge_token: validToken,
          response: validCredential,
          injected: 'payload',
        }),
      ).toThrow(ValidationError);
    });
  });
});
