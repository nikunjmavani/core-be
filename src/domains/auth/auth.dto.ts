import { z } from 'zod';
import { trimmedEmail, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';
import { AUTH_METHOD_TYPE } from '@/domains/auth/sub-domains/auth-method/auth-method.constants.js';

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

/** Zod schema for the `POST /api/v1/auth/me/mfa/verify` request body (6-digit TOTP code). */
export const MfaVerifyDto = z
  .object({
    code: z.string().trim().length(6).regex(/^\d+$/),
  })
  .strict();
/** Inferred input type of {@link MfaVerifyDto}. */
export type MfaVerifyInput = z.infer<typeof MfaVerifyDto>;

/**
 * Zod schema for the `POST /api/v1/auth/me/auth-methods` request body that links a new auth method
 * to the current user.
 *
 * route-#3: `method_type` is restricted to `MAGIC_LINK` — the only type this endpoint can create
 * as a functional credential-less row. `PASSWORD` needs a hash (set via the password flows),
 * `MFA_*` need an encrypted secret (set via the enroll ceremony), and `OAUTH` proves an external
 * identity (written only by the verified callback). Previously the DTO accepted every auth-method
 * type, so a user could insert a non-functional `PASSWORD`/`MFA_*` row that the last-login-capable
 * credential guard still counted — letting them delete their only real method and lock themselves
 * out. The provider identity fields are likewise never accepted here.
 */
export const CreateAuthMethodDto = z
  .object({
    method_type: z.literal(AUTH_METHOD_TYPE.MAGIC_LINK),
    is_primary: z.boolean().optional().default(false),
  })
  .strict();
/** Inferred input type of {@link CreateAuthMethodDto}. */
export type CreateAuthMethodInput = z.infer<typeof CreateAuthMethodDto>;

// Password

/** Minimum / maximum length and character-class requirements for a NEW password. */
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_MIN_CHARACTER_CLASSES = 3;

/** Counts how many of {lowercase, uppercase, digit, symbol} appear in `value`. */
function countPasswordCharacterClasses(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/\d/.test(value)) classes += 1;
  if (/[^a-z\d]/i.test(value)) classes += 1;
  return classes;
}

/**
 * Shared strength policy for every password-set entry point (reset, change) so the rule cannot
 * drift between them: trimmed, 12–128 chars, and at least 3 of 4 character classes (lowercase,
 * uppercase, digit, symbol).
 *
 * @remarks
 * Login / step-up / `current_password` verify an EXISTING credential and intentionally keep
 * `trimmedStringMinMax(1, 128)` — applying a strength policy there would lock out users whose
 * password predates the policy. Breach (HIBP k-anonymity) and strength-score (zxcvbn) checks are
 * deliberately left as optional future additions; this policy is the dependency-free baseline.
 */
export function passwordPolicy(): z.ZodType<string> {
  return trimmedStringMinMax(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH).refine(
    (value) => countPasswordCharacterClasses(value) >= PASSWORD_MIN_CHARACTER_CLASSES,
    { message: 'Password must include at least 3 of: lowercase, uppercase, number, symbol' },
  );
}

/** Zod schema for the `POST /api/v1/auth/password/forgot` request body. */
export const ForgotPasswordDto = z
  .object({
    email: trimmedEmail(),
  })
  .strict();
/** Inferred input type of {@link ForgotPasswordDto}. */
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordDto>;

/** Zod schema for the `POST /api/v1/auth/password/reset` request body (reset token + a policy-compliant new password). */
export const ResetPasswordDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
    password: passwordPolicy(),
  })
  .strict();
/** Inferred input type of {@link ResetPasswordDto}. */
export type ResetPasswordInput = z.infer<typeof ResetPasswordDto>;

/** Zod schema for the authenticated `POST /api/v1/auth/password/change` request body. */
export const ChangePasswordDto = z
  .object({
    current_password: trimmedStringMinMax(1, 128),
    new_password: passwordPolicy(),
  })
  .strict();
/** Inferred input type of {@link ChangePasswordDto}. */
export type ChangePasswordInput = z.infer<typeof ChangePasswordDto>;

/** Zod schema for the `POST /api/v1/auth/step-up` request body (password re-authentication). */
export const StepUpVerifyDto = z
  .object({
    password: trimmedStringMinMax(1, 128),
  })
  .strict();
/** Inferred input type of {@link StepUpVerifyDto}. */
export type StepUpVerifyInput = z.infer<typeof StepUpVerifyDto>;

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
/**
 * Zod schema for the authenticated `POST /api/v1/auth/me/mfa/enroll` request body
 * (TOTP enrollment INIT — phase 1 of the two-phase ceremony introduced in sec-A
 * finding #3). The init step stages the encrypted TOTP secret in Redis and
 * returns it to the caller; nothing is persisted to Postgres until the matching
 * `POST /auth/me/mfa/enroll/confirm` request verifies a fresh code.
 */
export const MfaEnrollDto = z
  .object({
    method_type: z.enum(['MFA_TOTP']),
  })
  .strict();
/** Inferred input type of {@link MfaEnrollDto}. */
export type MfaEnrollInput = z.infer<typeof MfaEnrollDto>;

/**
 * Zod schema for the authenticated `POST /api/v1/auth/me/mfa/enroll/confirm` request body
 * (TOTP enrollment CONFIRM — phase 2 of the two-phase ceremony). The caller submits a
 * 6-digit TOTP code generated from the secret returned by INIT; on success the server
 * atomically persists the auth_methods row, generates and hashes the recovery codes, and
 * flips `is_mfa_enabled`. On failure (invalid code, expired stage, etc.) nothing changes.
 */
export const MfaEnrollConfirmDto = z
  .object({
    code: z.string().trim().length(6).regex(/^\d+$/),
  })
  .strict();
/** Inferred input type of {@link MfaEnrollConfirmDto}. */
export type MfaEnrollConfirmInput = z.infer<typeof MfaEnrollConfirmDto>;

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

/**
 * Zod schema for the `:mfa_method_id` path parameter on `/api/v1/auth/me/mfa/:mfa_method_id`.
 *
 * route-#10: the param is an opaque 21-char public id (not the sequential DB id). `GET /mfa`
 * returns each method's public id as `id`, so this is round-trip compatible; it stops leaking
 * monotonic row ids and matches the public-id convention used everywhere else.
 */
export const mfaMethodIdParamsDto = z
  .object({
    mfa_method_id: z
      .string()
      .trim()
      .regex(/^am_[a-z0-9]{21}$/),
  })
  .strict();
/** Inferred input type of {@link mfaMethodIdParamsDto}. */
export type MfaMethodIdParamsInput = z.infer<typeof mfaMethodIdParamsDto>;

/** Zod schema for the `:auth_method_id` path parameter on `DELETE /api/v1/auth/me/auth-methods/:auth_method_id` (sec-new-B4). */
export const authMethodPublicIdParamsDto = z
  .object({
    auth_method_id: z
      .string()
      .trim()
      .regex(/^am_[a-z0-9]{21}$/),
  })
  .strict();
/** Inferred input type of {@link authMethodPublicIdParamsDto}. */
export type AuthMethodPublicIdParamsInput = z.infer<typeof authMethodPublicIdParamsDto>;

/** Zod schema for the `:session_id` (session public id) path parameter on `/api/v1/auth/me/sessions/:session_id`. */
export const sessionIdParamsDto = z
  .object({
    session_id: trimmedStringMinMax(1, 28),
  })
  .strict();
/** Inferred input type of {@link sessionIdParamsDto}. */
export type SessionIdParamsInput = z.infer<typeof sessionIdParamsDto>;
