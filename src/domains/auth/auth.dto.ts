import { z } from 'zod';
import { trimmedEmail, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for the `POST /api/v1/auth/login` request body (email + password). */
export const LoginDto = z
  .object({
    email: trimmedEmail(),
    password: trimmedStringMinMax(1, 128),
  })
  .strict();
/** Inferred input type of {@link LoginDto}. */
export type LoginInput = z.infer<typeof LoginDto>;

/** Zod schema for the `POST /api/v1/auth/magic-link/send` request body. */
export const MagicLinkSendDto = z
  .object({
    email: trimmedEmail(),
  })
  .strict();
/** Inferred input type of {@link MagicLinkSendDto}. */
export type MagicLinkSendInput = z.infer<typeof MagicLinkSendDto>;

/** Zod schema for the `POST /api/v1/auth/magic-link/verify` request body. */
export const MagicLinkVerifyDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
  })
  .strict();
/** Inferred input type of {@link MagicLinkVerifyDto}. */
export type MagicLinkVerifyInput = z.infer<typeof MagicLinkVerifyDto>;

/** Zod schema for the `POST /api/v1/auth/mfa/verify` request body (6-digit TOTP code). */
export const MfaVerifyDto = z
  .object({
    code: z.string().trim().length(6).regex(/^\d+$/),
  })
  .strict();
/** Inferred input type of {@link MfaVerifyDto}. */
export type MfaVerifyInput = z.infer<typeof MfaVerifyDto>;

/** Zod schema for the `POST /api/v1/auth/me/auth-methods` request body that links a new auth method to the current user. */
export const CreateAuthMethodDto = z
  .object({
    method_type: z.string().trim().max(20),
    provider: z.string().trim().max(50).optional(),
    provider_user_id: z.string().trim().max(255).optional(),
    is_primary: z.boolean().optional().default(false),
  })
  .strict();
/** Inferred input type of {@link CreateAuthMethodDto}. */
export type CreateAuthMethodInput = z.infer<typeof CreateAuthMethodDto>;

// Password
/** Zod schema for the `POST /api/v1/auth/password/forgot` request body. */
export const ForgotPasswordDto = z
  .object({
    email: trimmedEmail(),
  })
  .strict();
/** Inferred input type of {@link ForgotPasswordDto}. */
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDto>;

/** Zod schema for the `POST /api/v1/auth/password/reset` request body (reset token + new password ≥ 12 chars). */
export const ResetPasswordDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
    password: trimmedStringMinMax(12, 128),
  })
  .strict();
/** Inferred input type of {@link ResetPasswordDto}. */
export type ResetPasswordInput = z.infer<typeof ResetPasswordDto>;

/** Zod schema for the authenticated `POST /api/v1/auth/password/change` request body. */
export const ChangePasswordDto = z
  .object({
    current_password: trimmedStringMinMax(1, 128),
    new_password: trimmedStringMinMax(12, 128),
  })
  .strict();
/** Inferred input type of {@link ChangePasswordDto}. */
export type ChangePasswordInput = z.infer<typeof ChangePasswordDto>;

// Email verification
/** Zod schema for the `POST /api/v1/auth/email/verify` request body. */
export const VerifyEmailDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
  })
  .strict();
/** Inferred input type of {@link VerifyEmailDto}. */
export type VerifyEmailInput = z.infer<typeof VerifyEmailDto>;

// MFA
/** Zod schema for the authenticated `POST /api/v1/auth/mfa/enroll` request body (TOTP enrollment). */
export const MfaEnrollDto = z
  .object({
    method_type: z.enum(['MFA_TOTP']),
  })
  .strict();
/** Inferred input type of {@link MfaEnrollDto}. */
export type MfaEnrollInput = z.infer<typeof MfaEnrollDto>;

/** Zod schema for the `POST /api/v1/auth/mfa/challenge` request body (user id + 6-digit code). */
export const MfaChallengeDto = z
  .object({
    user_id: trimmedStringMinMax(1, 255),
    code: z.string().trim().length(6).regex(/^\d+$/),
  })
  .strict();
/** Inferred input type of {@link MfaChallengeDto}. */
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
/** Inferred input type of {@link MfaLoginVerifyDto}; exactly one of `totp_code` or `recovery_code` is required. */
export type MfaLoginVerifyInput = z.infer<typeof MfaLoginVerifyDto>;

// Note: Refresh token is now session-based via httpOnly cookie.
// No DTO needed — the session_id is read from the cookie automatically.

/** Zod schema for the `GET /api/v1/auth/oauth/:provider/callback` query string (`code` + opaque `state`). */
export const OauthCallbackQueryDto = z
  .object({
    code: trimmedStringMinMax(1, 2048),
    state: trimmedStringMinMax(1, 512),
  })
  .strict();

/** Inferred input type of {@link OauthCallbackQueryDto}. */
export type OauthCallbackQueryInput = z.infer<typeof OauthCallbackQueryDto>;

// Path params
/** Zod schema for the `:provider` path parameter on OAuth routes (`/api/v1/auth/oauth/:provider`). */
export const oauthProviderParamsDto = z
  .object({
    provider: trimmedStringMinMax(1, 50),
  })
  .strict();
/** Inferred input type of {@link oauthProviderParamsDto}. */
export type OauthProviderParamsInput = z.infer<typeof oauthProviderParamsDto>;

/** Zod schema for the `:mfaMethodId` path parameter on `/api/v1/auth/mfa/:mfaMethodId`. */
export const mfaMethodIdParamsDto = z
  .object({
    mfaMethodId: z.string().trim().regex(/^\d+$/),
  })
  .strict();
/** Inferred input type of {@link mfaMethodIdParamsDto}. */
export type MfaMethodIdParamsInput = z.infer<typeof mfaMethodIdParamsDto>;

/** Zod schema for the `:id` path parameter on `/api/v1/auth/me/auth-methods/:id`. */
export const authMethodIdParamsDto = z
  .object({
    id: z.string().trim().regex(/^\d+$/),
  })
  .strict();
/** Inferred input type of {@link authMethodIdParamsDto}. */
export type AuthMethodIdParamsInput = z.infer<typeof authMethodIdParamsDto>;

/** Zod schema for the `:id` (session public id) path parameter on `/api/v1/auth/me/sessions/:id`. */
export const sessionIdParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();
/** Inferred input type of {@link sessionIdParamsDto}. */
export type SessionIdParamsInput = z.infer<typeof sessionIdParamsDto>;
