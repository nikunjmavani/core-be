import { z } from 'zod';
import { trimmedEmail, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const LoginDto = z
  .object({
    email: trimmedEmail(),
    password: trimmedStringMinMax(1, 128),
  })
  .strict();
export type LoginInput = z.infer<typeof LoginDto>;

export const MagicLinkSendDto = z
  .object({
    email: trimmedEmail(),
  })
  .strict();
export type MagicLinkSendInput = z.infer<typeof MagicLinkSendDto>;

export const MagicLinkVerifyDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
  })
  .strict();
export type MagicLinkVerifyInput = z.infer<typeof MagicLinkVerifyDto>;

export const MfaVerifyDto = z
  .object({
    code: z.string().trim().length(6).regex(/^\d+$/),
  })
  .strict();
export type MfaVerifyInput = z.infer<typeof MfaVerifyDto>;

export const CreateAuthMethodDto = z
  .object({
    method_type: z.string().trim().max(20),
    provider: z.string().trim().max(50).optional(),
    provider_user_id: z.string().trim().max(255).optional(),
    is_primary: z.boolean().optional().default(false),
  })
  .strict();
export type CreateAuthMethodInput = z.infer<typeof CreateAuthMethodDto>;

// Password
export const ForgotPasswordDto = z
  .object({
    email: trimmedEmail(),
  })
  .strict();
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDto>;

export const ResetPasswordDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
    password: trimmedStringMinMax(12, 128),
  })
  .strict();
export type ResetPasswordInput = z.infer<typeof ResetPasswordDto>;

export const ChangePasswordDto = z
  .object({
    current_password: trimmedStringMinMax(1, 128),
    new_password: trimmedStringMinMax(12, 128),
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof ChangePasswordDto>;

// Email verification
export const VerifyEmailDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
  })
  .strict();
export type VerifyEmailInput = z.infer<typeof VerifyEmailDto>;

// MFA
export const MfaEnrollDto = z
  .object({
    method_type: z.enum(['MFA_TOTP']),
  })
  .strict();
export type MfaEnrollInput = z.infer<typeof MfaEnrollDto>;

export const MfaChallengeDto = z
  .object({
    user_id: trimmedStringMinMax(1, 255),
    code: z.string().trim().length(6).regex(/^\d+$/),
  })
  .strict();
export type MfaChallengeInput = z.infer<typeof MfaChallengeDto>;

/** Public login MFA step after password verification (no JWT yet). */
export const MfaLoginVerifyDto = z
  .object({
    mfa_session_token: trimmedStringMinMax(1, 128),
    totp_code: z.string().trim().length(6).regex(/^\d+$/).optional(),
    recovery_code: trimmedStringMinMax(8, 64).optional(),
  })
  .strict()
  .refine((value) => value.totp_code !== undefined || value.recovery_code !== undefined, {
    message: 'Either totp_code or recovery_code is required',
    path: ['totp_code'],
  });
export type MfaLoginVerifyInput = z.infer<typeof MfaLoginVerifyDto>;

// Note: Refresh token is now session-based via httpOnly cookie.
// No DTO needed — the session_id is read from the cookie automatically.

export const OauthCallbackQueryDto = z
  .object({
    code: trimmedStringMinMax(1, 2048),
    state: trimmedStringMinMax(1, 512),
  })
  .strict();

export type OauthCallbackQueryInput = z.infer<typeof OauthCallbackQueryDto>;

// Path params
export const oauthProviderParamsDto = z
  .object({
    provider: trimmedStringMinMax(1, 50),
  })
  .strict();
export type OauthProviderParamsInput = z.infer<typeof oauthProviderParamsDto>;

export const mfaMethodIdParamsDto = z
  .object({
    mfaMethodId: z.string().trim().regex(/^\d+$/),
  })
  .strict();
export type MfaMethodIdParamsInput = z.infer<typeof mfaMethodIdParamsDto>;

export const authMethodIdParamsDto = z
  .object({
    id: z.string().trim().regex(/^\d+$/),
  })
  .strict();
export type AuthMethodIdParamsInput = z.infer<typeof authMethodIdParamsDto>;

export const sessionIdParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();
export type SessionIdParamsInput = z.infer<typeof sessionIdParamsDto>;
