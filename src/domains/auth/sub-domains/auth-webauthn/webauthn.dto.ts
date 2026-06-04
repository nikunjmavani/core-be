import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

const webauthnTransportSchema = z.enum([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
] as const);

/**
 * Zod schema for the WebAuthn registration credential response body — mirrors
 * `RegistrationResponseJSON` from `@simplewebauthn/types`.
 */
export const webauthnRegistrationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    authenticatorData: z.string().optional(),
    transports: z.array(webauthnTransportSchema).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  type: z.literal('public-key'),
});

/**
 * Zod schema for the WebAuthn authentication assertion response body — mirrors
 * `AuthenticationResponseJSON` from `@simplewebauthn/types`.
 */
export const webauthnAuthenticationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  type: z.literal('public-key'),
});

/** Zod schema for the `POST /api/v1/auth/webauthn/authenticate/options` request body — optional `email` to scope the credential discovery. */
export const webauthnAuthenticateOptionsDto = z
  .object({
    email: trimmedStringMinMax(3, 320).pipe(z.email()).optional(),
  })
  .strict();

/** Zod schema for the `POST /api/v1/auth/webauthn/register/verify` request body — carries the opaque `challenge_token` and the WebAuthn registration response. */
export const webauthnRegisterVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: webauthnRegistrationResponseSchema,
  })
  .strict();

/** Zod schema for the `POST /api/v1/auth/webauthn/authenticate/verify` request body — carries the opaque `challenge_token` and the WebAuthn assertion response. */
export const webauthnAuthenticateVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: webauthnAuthenticationResponseSchema,
  })
  .strict();
