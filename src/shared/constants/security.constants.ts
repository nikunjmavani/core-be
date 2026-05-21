/** Authentication lockout, credential limits, and related security thresholds. */

/** Failed login attempts before the account is temporarily locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;

/** Account lockout duration after max failed login attempts (minutes). */
export const ACCOUNT_LOCKOUT_MINUTES = 30;
