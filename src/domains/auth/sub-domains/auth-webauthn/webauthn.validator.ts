import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnRegisterVerifyDto,
} from './webauthn.dto.js';

/** Validates the `POST /api/v1/auth/webauthn/authenticate/options` request body against {@link webauthnAuthenticateOptionsDto}; throws `ValidationError` on failure. */
export function validateWebauthnAuthenticateOptions(body: unknown) {
  return parseWithSchema(webauthnAuthenticateOptionsDto, body ?? {});
}

/** Validates the `POST /api/v1/auth/me/webauthn/register/verify` request body against {@link webauthnRegisterVerifyDto}; throws `ValidationError` on failure. */
export function validateWebauthnRegisterVerify(body: unknown) {
  return parseWithSchema(webauthnRegisterVerifyDto, body);
}

/** Validates the `POST /api/v1/auth/webauthn/authenticate/verify` request body against {@link webauthnAuthenticateVerifyDto}; throws `ValidationError` on failure. */
export function validateWebauthnAuthenticateVerify(body: unknown) {
  return parseWithSchema(webauthnAuthenticateVerifyDto, body);
}

/** Validates the `:credential_id` path param on `DELETE /api/v1/auth/me/webauthn/credentials/{credential_id}` as an opaque public id; throws `ValidationError` on failure. */
export function validateWebauthnCredentialIdParam(credentialId: string): string {
  return validatePublicIdParam(credentialId, 'credential_id');
}
