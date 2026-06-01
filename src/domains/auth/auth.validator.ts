import { ValidationError } from '@/shared/errors/index.js';
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
  MfaLoginVerifyDto,
  OauthCallbackQueryDto,
} from './auth.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

/** Validates the `POST /api/v1/auth/login` request body against {@link LoginDto}; throws {@link ValidationError} with field errors on failure. */
export function validateLogin(body: unknown): LoginInput {
  const result = LoginDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/magic-link/send` request body against {@link MagicLinkSendDto}. */
export function validateMagicLinkSend(body: unknown): MagicLinkSendInput {
  const result = MagicLinkSendDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/magic-link/verify` request body against {@link MagicLinkVerifyDto}. */
export function validateMagicLinkVerify(body: unknown): MagicLinkVerifyInput {
  const result = MagicLinkVerifyDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/mfa/verify` request body against {@link MfaVerifyDto}. */
export function validateMfaVerify(body: unknown): MfaVerifyInput {
  const result = MfaVerifyDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/me/auth-methods` request body against {@link CreateAuthMethodDto}. */
export function validateCreateAuthMethod(body: unknown): CreateAuthMethodInput {
  const result = CreateAuthMethodDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/password/forgot` request body against {@link ForgotPasswordDto}. */
export function validateForgotPassword(body: unknown): ForgotPasswordInput {
  const result = ForgotPasswordDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/password/reset` request body against {@link ResetPasswordDto}. */
export function validateResetPassword(body: unknown): ResetPasswordInput {
  const result = ResetPasswordDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the authenticated `POST /api/v1/auth/password/change` request body against {@link ChangePasswordDto}. */
export function validateChangePassword(body: unknown): ChangePasswordInput {
  const result = ChangePasswordDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the authenticated `POST /api/v1/auth/step-up` request body against {@link StepUpVerifyDto}. */
export function validateStepUpVerify(body: unknown): StepUpVerifyInput {
  const result = StepUpVerifyDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the `POST /api/v1/auth/email/verify` request body against {@link VerifyEmailDto}. */
export function validateVerifyEmail(body: unknown): VerifyEmailInput {
  const result = VerifyEmailDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the authenticated `POST /api/v1/auth/mfa/enroll` request body against {@link MfaEnrollDto}. */
export function validateMfaEnroll(body: unknown): MfaEnrollInput {
  const result = MfaEnrollDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the public login-flow MFA step body against {@link MfaLoginVerifyDto} (one of `totp_code` / `recovery_code` required). */
export function validateMfaLoginVerify(body: unknown): MfaLoginVerifyInput {
  const result = MfaLoginVerifyDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Validates the OAuth callback querystring (`code` + `state`) against {@link OauthCallbackQueryDto}. */
export function validateOauthCallbackQuery(query: unknown): OauthCallbackQueryInput {
  const result = OauthCallbackQueryDto.safeParse(query);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Parses the `:id` path param on auth-method routes into a positive integer; throws {@link ValidationError} otherwise. */
export function validateAuthMethodIdParam(authMethodId: string): number {
  const authMethodIdNumber = Number(authMethodId);
  if (!Number.isInteger(authMethodIdNumber) || authMethodIdNumber < 1) {
    throw new ValidationError('errors:validation.invalidAuthMethodId', undefined, {
      authMethodId: ['Must be a positive integer'],
    });
  }
  return authMethodIdNumber;
}

/** Parses the `:mfaMethodId` path param on MFA routes into a positive integer; throws {@link ValidationError} otherwise. */
export function validateMfaMethodIdParam(mfaMethodId: string): number {
  const mfaMethodIdNumber = Number(mfaMethodId);
  if (!Number.isInteger(mfaMethodIdNumber) || mfaMethodIdNumber < 1) {
    throw new ValidationError('errors:validation.invalidMfaMethodId', undefined, {
      mfaMethodId: ['Must be a positive integer'],
    });
  }
  return mfaMethodIdNumber;
}

// Note: validateRefreshToken removed — refresh is now session-based via httpOnly cookie.
