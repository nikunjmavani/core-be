import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const webauthnAuthenticateOptionsDto = z
  .object({
    email: trimmedStringMinMax(3, 320).email().optional(),
  })
  .strict();

export const webauthnRegisterVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();

export const webauthnAuthenticateVerifyDto = z
  .object({
    challenge_token: trimmedStringMinMax(64, 128),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();
