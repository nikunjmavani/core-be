import { describe, expect, it } from 'vitest';
import { MFA_RECOVERY_CODE_LENGTH } from '@/shared/constants/ttl.constants.js';
import {
  generateMfaRecoveryCode,
  generateMfaRecoveryCodes,
} from '@/domains/auth/sub-domains/auth-mfa/auth-mfa-recovery-code.util.js';

/**
 * Recovery codes BYPASS MFA — one of them is enough to complete a login without the enrolled
 * factor — and nothing asserted their length, alphabet, uniqueness, or batch size. A regression
 * that shortened the code, reintroduced an ambiguous character, or returned a batch with repeats
 * would have shipped silently.
 */

/** Crockford-style base32 with the visually-ambiguous characters dropped (mirrors the module const). */
const EXPECTED_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** The characters deliberately excluded so a code read off paper cannot be mis-transcribed. */
const AMBIGUOUS_CHARACTERS = ['I', 'L', 'O', '0', '1'];
const CODE_PATTERN = new RegExp(`^[${EXPECTED_ALPHABET}]{${MFA_RECOVERY_CODE_LENGTH}}$`);

describe('generateMfaRecoveryCode', () => {
  it('emits exactly MFA_RECOVERY_CODE_LENGTH characters from the expected alphabet', () => {
    const code = generateMfaRecoveryCode();
    expect(code).toHaveLength(MFA_RECOVERY_CODE_LENGTH);
    expect(code).toMatch(CODE_PATTERN);
  });

  it('never emits a visually-ambiguous character across a large sample', () => {
    // Rejection sampling loops until the buffer is full, so a single code is not enough to
    // prove the alphabet is respected on every draw — sample the whole space.
    const sample = Array.from({ length: 500 }, () => generateMfaRecoveryCode()).join('');
    for (const character of AMBIGUOUS_CHARACTERS) {
      expect(sample).not.toContain(character);
    }
    // Every emitted character must come from the alphabet, not merely avoid the excluded five.
    expect(new Set(sample).size).toBeLessThanOrEqual(EXPECTED_ALPHABET.length);
    for (const character of new Set(sample)) {
      expect(EXPECTED_ALPHABET).toContain(character);
    }
  });

  it('draws from the full alphabet rather than a biased subset', () => {
    // The rejection-sampling guard (`byte >= maxByte` -> continue) exists to eliminate modulo
    // bias. If it were removed or inverted, some symbols would never appear; 500 codes is
    // 6000 characters, so every one of the 31 symbols is overwhelmingly likely to show up.
    const observed = new Set(Array.from({ length: 500 }, () => generateMfaRecoveryCode()).join(''));
    expect(observed.size).toBe(EXPECTED_ALPHABET.length);
  });

  it('does not repeat itself across consecutive calls', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateMfaRecoveryCode()));
    expect(codes.size).toBe(200);
  });
});

describe('generateMfaRecoveryCodes', () => {
  it('honours the requested count', () => {
    // The caller (MFA enroll/confirm) shows the user exactly this many codes ONCE; returning
    // fewer would silently hand out a smaller recovery set than the UI promises.
    expect(generateMfaRecoveryCodes(10)).toHaveLength(10);
    expect(generateMfaRecoveryCodes(1)).toHaveLength(1);
  });

  it('returns distinct codes within a batch, each of the expected shape', () => {
    const codes = generateMfaRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(CODE_PATTERN);
    }
  });

  it('does not collide across separate batches', () => {
    // The Set dedup is per-batch; cross-batch collisions would mean the CSPRNG is not being
    // reseeded (or is stubbed), which would make one user's codes predict another's.
    const first = generateMfaRecoveryCodes(20);
    const second = generateMfaRecoveryCodes(20);
    expect(new Set([...first, ...second]).size).toBe(40);
  });

  it('terminates on a zero or negative count instead of looping forever', () => {
    // `while (codes.size < count)` is false immediately for count <= 0. Pinning this keeps a
    // future refactor (e.g. a `do/while`) from turning a bad argument into a hung request.
    expect(generateMfaRecoveryCodes(0)).toEqual([]);
    expect(generateMfaRecoveryCodes(-1)).toEqual([]);
  });
});
