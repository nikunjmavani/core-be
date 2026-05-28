import { ValidationError } from '@/shared/errors/index.js';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnRegisterVerifyDto,
} from './webauthn.dto.js';

/** Validates the `POST /api/v1/auth/webauthn/authenticate/options` request body against {@link webauthnAuthenticateOptionsDto}; throws {@link ValidationError} on failure. */
export function validateWebauthnAuthenticateOptions(body: unknown) {
  const parsed = webauthnAuthenticateOptionsDto.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError('errors:invalidInput', undefined, parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/** Validates the `POST /api/v1/auth/webauthn/register/verify` request body against {@link webauthnRegisterVerifyDto}; throws {@link ValidationError} on failure. */
export function validateWebauthnRegisterVerify(body: unknown) {
  const parsed = webauthnRegisterVerifyDto.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('errors:invalidInput', undefined, parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/** Validates the `POST /api/v1/auth/webauthn/authenticate/verify` request body against {@link webauthnAuthenticateVerifyDto}; throws {@link ValidationError} on failure. */
export function validateWebauthnAuthenticateVerify(body: unknown) {
  const parsed = webauthnAuthenticateVerifyDto.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('errors:invalidInput', undefined, parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
