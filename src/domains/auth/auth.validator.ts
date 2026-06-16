import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { ValidationError } from '@/shared/errors/index.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type {
  LoginInput,
  MagicLinkSendInput,
  MagicLinkVerifyInput,
  MfaVerifyInput,
  CreateAuthMethodInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
  StepUpVerifyInput,
  VerifyEmailInput,
  MfaEnrollInput,
  MfaEnrollConfirmInput,
  MfaLoginVerifyInput,
  OauthCallbackQueryInput,
} from './auth.dto.js';
import {
  LoginDto,
  MagicLinkSendDto,
  MagicLinkVerifyDto,
  MfaVerifyDto,
  CreateAuthMethodDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  StepUpVerifyDto,
  VerifyEmailDto,
  MfaEnrollDto,
  MfaEnrollConfirmDto,
  MfaLoginVerifyDto,
  OauthCallbackQueryDto,
} from './auth.dto.js';

/** Validates the `POST /api/v1/auth/login` request body against {@link LoginDto}; throws {@link ValidationError} with field errors on failure. */
export function validateLogin(body: unknown): LoginInput {
  return parseWithSchema(LoginDto, body);
}

/** Validates the `POST /api/v1/auth/magic-link/send` request body against {@link MagicLinkSendDto}. */
export function validateMagicLinkSend(body: unknown): MagicLinkSendInput {
  return parseWithSchema(MagicLinkSendDto, body);
}

/** Validates the `POST /api/v1/auth/magic-link/verify` request body against {@link MagicLinkVerifyDto}. */
export function validateMagicLinkVerify(body: unknown): MagicLinkVerifyInput {
  return parseWithSchema(MagicLinkVerifyDto, body);
}

/** Validates the `POST /api/v1/auth/me/mfa/verify` request body against {@link MfaVerifyDto}. */
export function validateMfaVerify(body: unknown): MfaVerifyInput {
  return parseWithSchema(MfaVerifyDto, body);
}

/** Validates the `POST /api/v1/auth/me/auth-methods` request body against {@link CreateAuthMethodDto}. */
export function validateCreateAuthMethod(body: unknown): CreateAuthMethodInput {
  return parseWithSchema(CreateAuthMethodDto, body);
}

/** Validates the `POST /api/v1/auth/password/forgot` request body against {@link ForgotPasswordDto}. */
export function validateForgotPassword(body: unknown): ForgotPasswordInput {
  return parseWithSchema(ForgotPasswordDto, body);
}

/** Validates the `POST /api/v1/auth/password/reset` request body against {@link ResetPasswordDto}. */
export function validateResetPassword(body: unknown): ResetPasswordInput {
  return parseWithSchema(ResetPasswordDto, body);
}

/** Validates the authenticated `POST /api/v1/auth/password/change` request body against {@link ChangePasswordDto}. */
export function validateChangePassword(body: unknown): ChangePasswordInput {
  return parseWithSchema(ChangePasswordDto, body);
}

/** Validates the authenticated `POST /api/v1/auth/step-up` request body against {@link StepUpVerifyDto}. */
export function validateStepUpVerify(body: unknown): StepUpVerifyInput {
  return parseWithSchema(StepUpVerifyDto, body);
}

/** Validates the `POST /api/v1/auth/email/verify` request body against {@link VerifyEmailDto}. */
export function validateVerifyEmail(body: unknown): VerifyEmailInput {
  return parseWithSchema(VerifyEmailDto, body);
}

/** Validates the authenticated `POST /api/v1/auth/me/mfa/enroll` request body against {@link MfaEnrollDto}. */
export function validateMfaEnroll(body: unknown): MfaEnrollInput {
  return parseWithSchema(MfaEnrollDto, body);
}

/** Validates the authenticated `POST /api/v1/auth/me/mfa/enroll/confirm` request body against {@link MfaEnrollConfirmDto}. */
export function validateMfaEnrollConfirm(body: unknown): MfaEnrollConfirmInput {
  return parseWithSchema(MfaEnrollConfirmDto, body);
}

/** Validates the public login-flow MFA step body against {@link MfaLoginVerifyDto} (one of `totp_code` / `recovery_code` required). */
export function validateMfaLoginVerify(body: unknown): MfaLoginVerifyInput {
  return parseWithSchema(MfaLoginVerifyDto, body);
}

/** Validates the OAuth callback querystring (`code` + `state`) against {@link OauthCallbackQueryDto}. */
export function validateOauthCallbackQuery(query: unknown): OauthCallbackQueryInput {
  return parseWithSchema(OauthCallbackQueryDto, query);
}

/**
 * Validates the `:publicId` path param on auth-method routes (sec-new-B4). Returns the
 * 21-character alphanumeric public id; throws {@link ValidationError} when the value is not
 * exactly 21 lowercase alphanumeric characters (the shape produced by {@link generatePublicId}).
 */
export function validateAuthMethodPublicIdParam(authMethodPublicId: string): string {
  if (!/^am_[a-z0-9]{21}$/.test(authMethodPublicId)) {
    throw new ValidationError('errors:validation.invalidAuthMethodId', undefined, {
      authMethodPublicId: ['Must be an am_-prefixed 21-character lowercase alphanumeric public id'],
    });
  }
  return authMethodPublicId;
}

/**
 * Validates the `:mfa_method_id` path param on MFA routes as an opaque public id (route-#10);
 * throws {@link ValidationError} otherwise.
 */
export function validateMfaMethodIdParam(mfaMethodId: string): string {
  return validatePublicIdParam(mfaMethodId, 'mfa_method_id');
}

// Note: validateRefreshToken removed — refresh is now session-based via httpOnly cookie.
