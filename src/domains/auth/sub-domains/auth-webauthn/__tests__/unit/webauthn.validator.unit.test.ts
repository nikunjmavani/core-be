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
    const validResponse = {
      id: 'credential-id',
      rawId: 'raw-id',
      response: { clientDataJSON: 'data', attestationObject: 'obj' },
      type: 'public-key' as const,
    };

    it('accepts challenge_token exactly 64 chars (min boundary) with valid response', () => {
      const result = validateWebauthnRegisterVerify({
        challenge_token: minToken,
        response: validResponse,
      });
      expect(result.challenge_token).toBe(minToken);
      // Zod applies the clientExtensionResults default; assert on the input keys we care about.
      expect(result.response.id).toBe(validResponse.id);
      expect(result.response.rawId).toBe(validResponse.rawId);
      expect(result.response.response).toEqual(validResponse.response);
      expect(result.response.type).toBe(validResponse.type);
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
      // Zod applies the clientExtensionResults default; assert on the input keys we care about.
      expect(result.response.id).toBe(validCredential.id);
      expect(result.response.rawId).toBe(validCredential.rawId);
      expect(result.response.response).toEqual(validCredential.response);
      expect(result.response.type).toBe(validCredential.type);
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
