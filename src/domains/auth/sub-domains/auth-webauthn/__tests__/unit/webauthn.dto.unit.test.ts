import { describe, expect, it } from 'vitest';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnCredentialIdParamsDto,
  webauthnRegisterVerifyDto,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn.dto.js';

const base64url = 'AQIDBAUGBwgJCgsMDQ4PEA';

const registerBody = {
  challenge_token: 'c'.repeat(64),
  response: {
    id: base64url,
    rawId: base64url,
    response: { clientDataJSON: base64url, attestationObject: base64url },
    type: 'public-key',
  },
};

const authenticateBody = {
  challenge_token: 'c'.repeat(64),
  response: {
    id: base64url,
    rawId: base64url,
    response: {
      clientDataJSON: base64url,
      authenticatorData: base64url,
      signature: base64url,
    },
    type: 'public-key',
  },
};

/**
 * The WebAuthn ceremony schemas. Two of these constraints are not what they look like.
 *
 * `email` on the authenticate-options body is REQUIRED, and that is an anti-enumeration decision
 * rather than a convenience. The service equalises unknown accounts (and known accounts with no
 * credentials) behind a deterministic decoy challenge, so the response never reveals whether an
 * address maps to a real user. But the service throws when `email` is absent — so if the DTO let
 * the field be optional, "omit the email" would become a present-vs-absent oracle that walks
 * straight past the decoy path. The DTO is what keeps that contract honest.
 *
 * `clientExtensionResults` is deliberately NOT `.strict()`, unlike every other object here. It
 * mirrors a browser-native W3C payload whose extension set grows over time; unknown extension
 * fields are stripped rather than rejected, so a newer browser cannot break registration by
 * volunteering an extension this server has not heard of. The bodies that wrap it are strict.
 */
describe('webauthn.dto', () => {
  describe('webauthnAuthenticateOptionsDto — email is required (anti-enumeration)', () => {
    it('accepts a well-formed email', () => {
      expect(
        webauthnAuthenticateOptionsDto.safeParse({ email: 'person@example.com' }).success,
      ).toBe(true);
    });

    it('REJECTS an omitted email so it cannot become a present-vs-absent oracle', () => {
      // Making this optional would let a caller skip the decoy path entirely.
      expect(webauthnAuthenticateOptionsDto.safeParse({}).success).toBe(false);
    });

    it.each([
      ['null', null],
      ['an empty string', ''],
      ['a non-email string', 'not-an-email'],
      ['a two-character value', 'ab'],
      ['a number', 42],
    ])('rejects %s', (_label, email) => {
      expect(webauthnAuthenticateOptionsDto.safeParse({ email }).success).toBe(false);
    });

    it('rejects an email over 320 characters', () => {
      const email = `${'a'.repeat(320)}@example.com`;

      expect(webauthnAuthenticateOptionsDto.safeParse({ email }).success).toBe(false);
    });

    it('trims surrounding whitespace', () => {
      expect(webauthnAuthenticateOptionsDto.parse({ email: '  person@example.com  ' }).email).toBe(
        'person@example.com',
      );
    });

    it('rejects an extra key that might scope discovery differently (.strict)', () => {
      expect(
        webauthnAuthenticateOptionsDto.safeParse({
          email: 'person@example.com',
          user_id: 'usr_other',
        }).success,
      ).toBe(false);
    });
  });

  describe('challenge_token bounds', () => {
    const schemas = [
      ['webauthnRegisterVerifyDto', webauthnRegisterVerifyDto, registerBody],
      ['webauthnAuthenticateVerifyDto', webauthnAuthenticateVerifyDto, authenticateBody],
    ] as const;

    it.each(schemas)('%s accepts a 64-character token', (_name, schema, body) => {
      expect(schema.safeParse(body).success).toBe(true);
    });

    it.each(schemas)('%s accepts a 128-character token', (_name, schema, body) => {
      expect(schema.safeParse({ ...body, challenge_token: 'c'.repeat(128) }).success).toBe(true);
    });

    it.each(schemas)('%s rejects a 63-character token', (_name, schema, body) => {
      // The floor is what stops a trivially guessable challenge reference being accepted.
      expect(schema.safeParse({ ...body, challenge_token: 'c'.repeat(63) }).success).toBe(false);
    });

    it.each(schemas)('%s rejects a 129-character token', (_name, schema, body) => {
      expect(schema.safeParse({ ...body, challenge_token: 'c'.repeat(129) }).success).toBe(false);
    });

    it.each(schemas)('%s rejects a missing token', (_name, schema, body) => {
      const { challenge_token: _omitted, ...withoutToken } = body;

      expect(schema.safeParse(withoutToken).success).toBe(false);
    });
  });

  describe('binary field bounds', () => {
    it('accepts a 65536-character clientDataJSON', () => {
      const body = structuredClone(registerBody);
      body.response.response.clientDataJSON = 'a'.repeat(65536);

      expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(true);
    });

    it('rejects an oversized attestation object', () => {
      // Unbounded attestation is a cheap memory-amplification vector on an unauthenticated-ish
      // ceremony endpoint.
      const body = structuredClone(registerBody);
      body.response.response.attestationObject = 'a'.repeat(65537);

      expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(false);
    });

    it('rejects an empty binary field', () => {
      const body = structuredClone(registerBody);
      body.response.response.clientDataJSON = '';

      expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(false);
    });

    it('rejects an oversized assertion signature', () => {
      const body = structuredClone(authenticateBody);
      body.response.response.signature = 'a'.repeat(65537);

      expect(webauthnAuthenticateVerifyDto.safeParse(body).success).toBe(false);
    });
  });

  describe('ceremony payload shape', () => {
    it('requires type to be exactly "public-key"', () => {
      expect(
        webauthnRegisterVerifyDto.safeParse({
          ...registerBody,
          response: { ...registerBody.response, type: 'password' },
        }).success,
      ).toBe(false);
    });

    it('requires the attestation object on registration', () => {
      const { attestationObject: _omitted, ...withoutAttestation } = registerBody.response.response;
      const body = {
        ...registerBody,
        response: { ...registerBody.response, response: withoutAttestation },
      };

      expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(false);
    });

    it.each([['authenticatorData'], ['signature'], ['clientDataJSON']])(
      'requires %s on authentication',
      (field) => {
        const inner = Object.fromEntries(
          Object.entries(authenticateBody.response.response).filter(([key]) => key !== field),
        );
        const body = {
          ...authenticateBody,
          response: { ...authenticateBody.response, response: inner },
        };

        expect(webauthnAuthenticateVerifyDto.safeParse(body).success).toBe(false);
      },
    );

    it.each([['usb'], ['nfc'], ['ble'], ['internal'], ['hybrid'], ['cable'], ['smart-card']])(
      'accepts the %s transport',
      (transport) => {
        const body = structuredClone(registerBody);
        (body.response.response as { transports?: string[] }).transports = [transport];

        expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(true);
      },
    );

    it('rejects an unknown transport', () => {
      const body = structuredClone(registerBody);
      (body.response.response as { transports?: string[] }).transports = ['telepathy'];

      expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(false);
    });

    it('rejects more than 10 transports', () => {
      const body = structuredClone(registerBody);
      (body.response.response as { transports?: string[] }).transports = Array.from(
        { length: 11 },
        () => 'usb',
      );

      expect(webauthnRegisterVerifyDto.safeParse(body).success).toBe(false);
    });

    it.each([['cross-platform'], ['platform']])(
      'accepts authenticatorAttachment %s',
      (authenticatorAttachment) => {
        expect(
          webauthnRegisterVerifyDto.safeParse({
            ...registerBody,
            response: { ...registerBody.response, authenticatorAttachment },
          }).success,
        ).toBe(true);
      },
    );

    it('rejects an unknown authenticatorAttachment', () => {
      expect(
        webauthnRegisterVerifyDto.safeParse({
          ...registerBody,
          response: { ...registerBody.response, authenticatorAttachment: 'implant' },
        }).success,
      ).toBe(false);
    });
  });

  describe('clientExtensionResults — forward-compatible by design', () => {
    it('accepts the known extensions', () => {
      expect(
        webauthnRegisterVerifyDto.safeParse({
          ...registerBody,
          response: {
            ...registerBody.response,
            clientExtensionResults: {
              appid: true,
              credProps: { rk: true },
              hmacCreateSecret: false,
            },
          },
        }).success,
      ).toBe(true);
    });

    it('STRIPS an unknown extension rather than rejecting it', () => {
      // Deliberately not .strict(): the W3C extension registry grows, and a newer browser
      // volunteering an unknown extension must not break registration.
      const result = webauthnRegisterVerifyDto.safeParse({
        ...registerBody,
        response: {
          ...registerBody.response,
          clientExtensionResults: { appid: true, futureExtension: 'whatever' },
        },
      });

      expect(result.success).toBe(true);
      expect(result.success && result.data.response.clientExtensionResults).toEqual({
        appid: true,
      });
    });

    it('still rejects a known extension with the wrong type', () => {
      // Forward-compatible is not the same as unvalidated.
      expect(
        webauthnRegisterVerifyDto.safeParse({
          ...registerBody,
          response: {
            ...registerBody.response,
            clientExtensionResults: { appid: 'yes' },
          },
        }).success,
      ).toBe(false);
    });
  });

  describe('mass-assignment boundary', () => {
    it.each([
      ['a user id', { user_id: 'usr_other' }],
      ['a credential id', { credential_id: 'wac_abcdefghijklmnopqrstu' }],
      ['an origin override', { origin: 'https://evil.example.com' }],
    ])('rejects %s on the register body (.strict)', (_label, extra) => {
      // The origin is read from the request, never from the body — accepting one here would hand
      // the caller the phishing-resistance property to set for themselves.
      expect(webauthnRegisterVerifyDto.safeParse({ ...registerBody, ...extra }).success).toBe(
        false,
      );
    });

    it('rejects an origin override on the authenticate body', () => {
      expect(
        webauthnAuthenticateVerifyDto.safeParse({
          ...authenticateBody,
          origin: 'https://evil.example.com',
        }).success,
      ).toBe(false);
    });
  });

  describe('webauthnCredentialIdParamsDto', () => {
    const valid = `wac_${'a'.repeat(21)}`;

    it('accepts a canonical wac_ public id', () => {
      expect(webauthnCredentialIdParamsDto.safeParse({ credential_id: valid }).success).toBe(true);
    });

    it.each([
      ['a sequential database id', '42'],
      ['a raw WebAuthn credential blob', base64url],
      ['the wrong entity prefix', `usr_${'a'.repeat(21)}`],
      ['a short suffix', `wac_${'a'.repeat(20)}`],
      ['a long suffix', `wac_${'a'.repeat(22)}`],
      ['an uppercase suffix', `wac_${'A'.repeat(21)}`],
      ['an empty id', ''],
    ])('rejects %s', (_label, credential_id) => {
      // This is the layer that pins the `wac_` prefix specifically — the handler helper only
      // checks the generic public-id shape.
      expect(webauthnCredentialIdParamsDto.safeParse({ credential_id }).success).toBe(false);
    });

    it('rejects an extra param', () => {
      expect(
        webauthnCredentialIdParamsDto.safeParse({ credential_id: valid, user_id: 'usr_other' })
          .success,
      ).toBe(false);
    });
  });
});
