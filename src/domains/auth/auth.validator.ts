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
  VerifyEmailInput,
  MfaEnrollInput,
  MfaChallengeInput,
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
  VerifyEmailDto,
  MfaEnrollDto,
  MfaChallengeDto,
  MfaLoginVerifyDto,
  OauthCallbackQueryDto,
} from './auth.dto.js';

const ERROR_KEY_INVALID_INPUT = 'errors:invalidInput';

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

export function validateMfaChallenge(body: unknown): MfaChallengeInput {
  const result = MfaChallengeDto.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      ERROR_KEY_INVALID_INPUT,
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

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

export function validateAuthMethodIdParam(authMethodId: string): number {
  const authMethodIdNumber = Number(authMethodId);
  if (!Number.isInteger(authMethodIdNumber) || authMethodIdNumber < 1) {
    throw new ValidationError('errors:validation.invalidAuthMethodId', undefined, {
      authMethodId: ['Must be a positive integer'],
    });
  }
  return authMethodIdNumber;
}

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
