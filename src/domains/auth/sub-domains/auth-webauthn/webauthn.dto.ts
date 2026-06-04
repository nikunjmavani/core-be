import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for the `POST /api/v1/auth/webauthn/authenticate/options` request body — optional `email` to scope the credential discovery. */
export const webauthnAuthenticateOptionsDto = z
  .object({
    email: trimmedStringMinMax(3, 320).pipe(z.email()).optional(),
  })
  .strict();

/**
 * Base64URL-encoded binary field (id, rawId, clientDataJSON, etc.).
 * Bounded to 65536 bytes (64 KB) to prevent oversized attestation objects.
 */
const base64URLString = z.string().min(1).max(65536);

/**
 * Known transport types from the WebAuthn Level 3 spec plus `cable`/`hybrid`.
 * Mirrors `AuthenticatorTransportFuture` from `@simplewebauthn/server`.
 */
const authenticatorTransport = z.enum([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);

/**
 * Subset of `AuthenticationExtensionsClientOutputs` covering the three extensions
 * recognised by `@simplewebauthn/server`. Unknown extension fields are stripped
 * (Zod's default behaviour without `.strict()`).
 */
const clientExtensionResultsSchema = z.object({
  appid: z.boolean().optional(),
  credProps: z.object({ rk: z.boolean().optional() }).optional(),
  hmacCreateSecret: z.boolean().optional(),
});

/**
 * Typed shape for `AuthenticatorAttestationResponseJSON` — the registration ceremony
 * payload produced by `navigator.credentials.create()` serialised to Base64URL strings.
 */
const attestationResponseSchema = z.object({
  clientDataJSON: base64URLString,
  attestationObject: base64URLString,
  authenticatorData: base64URLString.optional(),
  transports: z.array(authenticatorTransport).max(10).optional(),
  publicKeyAlgorithm: z.number().int().optional(),
  publicKey: base64URLString.optional(),
});

/**
 * Typed shape for `AuthenticatorAssertionResponseJSON` — the authentication ceremony
 * payload produced by `navigator.credentials.get()` serialised to Base64URL strings.
 */
const assertionResponseSchema = z.object({
  clientDataJSON: base64URLString,
  authenticatorData: base64URLString,
  signature: base64URLString,
  userHandle: base64URLString.optional(),
});

/**
 * Zod schema for the `POST /api/v1/auth/webauthn/register/verify` request body.
 * The `response` field mirrors `RegistrationResponseJSON` from `@simplewebauthn/server`
 * with explicit bounds on all binary fields, eliminating the need for an unsafe cast
 * in the service layer.
 */
export const webauthnRegisterVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: z.object({
      id: base64URLString,
      rawId: base64URLString,
      response: attestationResponseSchema,
      authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
      clientExtensionResults: clientExtensionResultsSchema.optional(),
      type: z.literal('public-key'),
    }),
  })
  .strict();

/**
 * Zod schema for the `POST /api/v1/auth/webauthn/authenticate/verify` request body.
 * The `response` field mirrors `AuthenticationResponseJSON` from `@simplewebauthn/server`
 * with explicit bounds on all binary fields, eliminating the need for an unsafe cast
 * in the service layer.
 */
export const webauthnAuthenticateVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: z.object({
      id: base64URLString,
      rawId: base64URLString,
      response: assertionResponseSchema,
      authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
      clientExtensionResults: clientExtensionResultsSchema.optional(),
      type: z.literal('public-key'),
    }),
  })
  .strict();
