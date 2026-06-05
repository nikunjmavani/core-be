/** Authentication lockout, credential limits, and related security thresholds. */

/**
 * AES-256-GCM IV length in bytes — the recommended 96-bit nonce for GCM mode
 * (`crypto.createCipheriv('aes-256-gcm', key, iv)`). Used by both the generic
 * `encryptPayload`/`decryptPayload` helpers and the versioned field-secret
 * encryption utility; centralized so the value is a single source of truth.
 */
export const AES_GCM_IV_LENGTH = 12;

/** Failed login attempts before the account is temporarily locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;

/** Account lockout duration after max failed login attempts (minutes). */
export const ACCOUNT_LOCKOUT_MINUTES = 30;

/** Failed login attempts from a single IP before that IP is blocked for the window. */
export const IP_FAILED_LOGIN_THRESHOLD = 50;

/** Sliding window duration for the per-IP failed-login counter (seconds). */
export const IP_FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;
