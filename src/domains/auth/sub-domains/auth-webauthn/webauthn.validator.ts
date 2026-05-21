import { ValidationError } from '@/shared/errors/index.js';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnRegisterVerifyDto,
} from './webauthn.dto.js';

export function validateWebauthnAuthenticateOptions(body: unknown) {
  const parsed = webauthnAuthenticateOptionsDto.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError('errors:invalidInput', undefined, parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export function validateWebauthnRegisterVerify(body: unknown) {
  const parsed = webauthnRegisterVerifyDto.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('errors:invalidInput', undefined, parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export function validateWebauthnAuthenticateVerify(body: unknown) {
  const parsed = webauthnAuthenticateVerifyDto.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('errors:invalidInput', undefined, parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
