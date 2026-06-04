/** Authentication lockout, credential limits, and related security thresholds. */

/** Failed login attempts before the account is temporarily locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;

/** Account lockout duration after max failed login attempts (minutes). */
export const ACCOUNT_LOCKOUT_MINUTES = 30;

/** Failed login attempts from a single IP before that IP is blocked for the window. */
export const IP_FAILED_LOGIN_THRESHOLD = 50;

/** Sliding window duration for the per-IP failed-login counter (seconds). */
export const IP_FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;
