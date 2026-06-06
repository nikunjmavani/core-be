import { randomBytes } from 'node:crypto';
import { MFA_RECOVERY_CODE_LENGTH } from '@/shared/constants/ttl.constants.js';

/**
 * Crockford-style base32 alphabet with the visually-ambiguous characters dropped
 * (no `I`, `L`, `O`, `0`, `1`). 32 symbols → exactly 5 bits per character, so a
 * {@link MFA_RECOVERY_CODE_LENGTH}-char code carries 60 bits of entropy.
 *
 * @remarks
 * Recovery codes are read off paper / a password manager; the dropped characters
 * eliminate the most common transcription mistakes. The deliberate uppercase
 * (no lowercase) keeps comparison case-insensitive in the user's head while the
 * server's SHA-256 hashing stays exact (callers should normalise to uppercase
 * before hashing — see {@link hashMfaRecoveryCode}).
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
