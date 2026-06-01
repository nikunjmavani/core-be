import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

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
    response: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Zod schema for the `POST /api/v1/auth/webauthn/authenticate/verify` request body — carries the opaque `challenge_token` and the WebAuthn assertion response. */
export const webauthnAuthenticateVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();
