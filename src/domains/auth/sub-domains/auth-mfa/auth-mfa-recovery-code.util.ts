import { randomBytes } from 'node:crypto';
import { MFA_RECOVERY_CODE_LENGTH } from '@/shared/constants/ttl.constants.js';

/**
 * Crockford-style base32 alphabet with the visually-ambiguous characters dropped
 * (no `I`, `L`, `O`, `0`, `1`). sec-re-14: **31 symbols** (23 letters + 8 digits)
 * → log₂(31) ≈ 4.954 bits per character, so a {@link MFA_RECOVERY_CODE_LENGTH}-char
 * code carries ~59.4 bits of entropy — not the 60 bits the earlier comment claimed.
 * The shortfall is operationally negligible (well above the threshold at which
 * the single-use `consumeMfaRecoveryCode` UPDATE filter + per-IP rate limit make
 * online brute-force infeasible), but the docstring should match reality so future
 * tuning has the right baseline.
 *
 * @remarks
 * Recovery codes are read off paper / a password manager; the dropped characters
 * eliminate the most common transcription mistakes. The alphabet is intentionally
 * uppercase-only; the matching `hashMfaRecoveryCode` uppercases the user-supplied
 * code before SHA-256 (sec-re-14) so a user who types in lowercase or mixed case
 * still authenticates against the stored hash.
 */
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ALPHABET_SIZE = RECOVERY_CODE_ALPHABET.length;

/**
 * Generate one MFA recovery code: `MFA_RECOVERY_CODE_LENGTH` characters drawn from
 * {@link RECOVERY_CODE_ALPHABET} via CSPRNG with rejection sampling to eliminate
 * modulo bias.
 *
 * @remarks
 * - **Algorithm:** sample bytes via `node:crypto.randomBytes`, reject any byte whose
 *   modulo against the alphabet size would introduce bias (`maxByte = floor(256/N)*N`),
 *   keep drawing until the result is full.
 * - **Failure modes:** none — exhausts the entropy buffer transparently.
 * - **Side effects:** none.
 */
export function generateMfaRecoveryCode(): string {
  const maxByte = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;
  const result: string[] = [];

  while (result.length < MFA_RECOVERY_CODE_LENGTH) {
    const bytes = randomBytes(MFA_RECOVERY_CODE_LENGTH - result.length + 4);
    for (const byte of bytes) {
      if (byte >= maxByte) continue;
      result.push(RECOVERY_CODE_ALPHABET[byte % ALPHABET_SIZE]!);
      if (result.length === MFA_RECOVERY_CODE_LENGTH) break;
    }
  }

  return result.join('');
}

/**
 * Generate `count` unique MFA recovery codes. Duplicates within a single batch are
 * extremely improbable at 60 bits of entropy per code (birthday-paradox collision odds
 * ≈ count² / 2^61); a Set-based dedup is the cheap guardrail.
 */
export function generateMfaRecoveryCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateMfaRecoveryCode());
  }
  return Array.from(codes);
}
