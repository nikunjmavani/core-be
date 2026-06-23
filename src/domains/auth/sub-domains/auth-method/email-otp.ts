import { createHash, randomInt } from 'node:crypto';

/** Number of decimal digits in an email one-time passcode (OTP). */
export const EMAIL_OTP_LENGTH = 6;
/** Minutes an issued email OTP stays valid before it must be re-requested. */
export const EMAIL_OTP_TTL_MINUTES = 15;
/**
 * Per-user verification attempts allowed within the OTP's lifetime before further tries are rejected.
 * A 6-digit code has only 1e6 values, so this online cap (paired with the short TTL + single-use
 * consume) is what makes guessing infeasible — mirrors the MFA TOTP verification budget.
 */
export const EMAIL_OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Seconds a caller must wait between successive OTP resends for the same purpose (anti-spam). */
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Generates a cryptographically-random numeric OTP of {@link EMAIL_OTP_LENGTH} digits.
 *
 * @remarks
 * - **Algorithm:** one `crypto.randomInt(0, 10**length)` draw (uniform CSPRNG — never `Math.random`),
 *   zero-padded so the code is always exactly {@link EMAIL_OTP_LENGTH} characters (leading zeros kept,
 *   so `42` becomes `000042` and the keyspace is the full 1e6).
 * - **Side effects:** none.
 * - **Notes:** the raw code is emailed to the user and never persisted; only {@link hashEmailOtp} of it
 *   is stored. Guess-resistance comes from the short TTL, single-use consume, and per-user attempt cap
 *   ({@link EMAIL_OTP_MAX_VERIFY_ATTEMPTS}) — not from the code's entropy.
 */
export function generateEmailOtp(): string {
  return randomInt(0, 10 ** EMAIL_OTP_LENGTH)
    .toString()
    .padStart(EMAIL_OTP_LENGTH, '0');
}

/**
 * SHA-256 hex digest of an OTP — the only form persisted (in `verification_tokens.token_hash`).
 *
 * @remarks
 * - **Algorithm:** `sha256(code)` hex (64 chars, matching the column width used for random tokens).
 * - **Side effects:** none.
 * - **Notes:** the lookup that consumes it MUST be scoped to the owning user + token type
 *   ({@link import('./verification-token/verification-token.repository.js').VerificationTokenRepository.consumeOtpForUser})
 *   because the hash of a 6-digit code is not, on its own, a secret.
 */
export function hashEmailOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
