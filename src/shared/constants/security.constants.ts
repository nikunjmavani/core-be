/** Authentication lockout, credential limits, and related security thresholds. */

/**
 * AES-256-GCM IV length in bytes — the recommended 96-bit nonce for GCM mode
 * (`crypto.createCipheriv('aes-256-gcm', key, iv)`). Used by both the generic
 * `encryptPayload`/`decryptPayload` helpers and the versioned field-secret
 * encryption utility; centralized so the value is a single source of truth.
 */
export const AES_GCM_IV_LENGTH = 12;

/** AES-256-GCM cipher identifier passed to Node `crypto.createCipheriv` / `createDecipheriv`. */
export const AES_GCM_ALGORITHM = 'aes-256-gcm';

/**
 * Minimum acceptable zxcvbn strength score (0–4 scale) for a newly set password
 * (reset / change flows). `3` is "safely unguessable" — it withstands an offline
 * slow-hash attack of ~10^8 guesses — and is the level OWASP/NIST-aligned guidance
 * treats as the floor for human-chosen secrets. Below this the password is rejected
 * with `errors:validation.weakPassword`. Enforcement is gated by the
 * `PASSWORD_STRENGTH_CHECK_ENABLED` env flag; see `password-strength.util.ts`.
 */
export const MINIMUM_ACCEPTABLE_PASSWORD_SCORE = 3;

/** Failed login attempts before the account is temporarily locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;

/** Account lockout duration after max failed login attempts (minutes). */
export const ACCOUNT_LOCKOUT_MINUTES = 30;

/**
 * Failed MFA verification attempts (TOTP or recovery code) per user before MFA
 * verification is temporarily locked (audit-#12).
 *
 * @remarks
 * The `/auth/me/mfa/verify` step-up and `/auth/mfa/login` second factor were gated only by
 * a per-user rate limit with no account-level lockout, unlike the password path. With a
 * stolen-but-valid bearer token an attacker could keep guessing TOTP codes indefinitely.
 * This per-user counter mirrors {@link MAX_FAILED_LOGIN_ATTEMPTS} and locks verification
 * for {@link MFA_VERIFICATION_LOCKOUT_TTL_SECONDS} after the threshold.
 */
export const MAX_MFA_VERIFICATION_ATTEMPTS = 10;

/** Failed login attempts from a single IP before that IP is blocked for the window. */
export const IP_FAILED_LOGIN_THRESHOLD = 50;

/** Sliding window duration for the per-IP failed-login counter (seconds). */
export const IP_FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;

/**
 * Grace window (ms) during which the refresh compare-and-swap also accepts the immediately-previous
 * refresh hash (audit-#2).
 *
 * @remarks
 * Two concurrent legitimate refreshes presenting the same cookie can race: one rotates the stored
 * hash and the loser would otherwise observe a different hash and be misclassified as stolen-token
 * reuse — revoking the user's whole session family. Accepting the just-rotated previous hash for a
 * few seconds lets the concurrent duplicate succeed; a replay AFTER this window still falls through
 * to reuse detection / family revocation. Kept short to bound the relaxation of reuse detection.
 */
export const REFRESH_TOKEN_REUSE_GRACE_MS = 10_000;
