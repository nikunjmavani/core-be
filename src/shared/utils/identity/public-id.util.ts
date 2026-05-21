import { randomBytes } from 'node:crypto';

/** 21-char URL-safe id for public_id exposure in APIs (NanoID-compatible length) */
export const PUBLIC_ID_LENGTH = 21;

/** Matches tenant header and route public ids (21 URL-safe characters). */
export const PUBLIC_ID_REGEX = /^[A-Za-z0-9_-]{21}$/;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ALPHABET_SIZE = ALPHABET.length; // 36

/**
 * Generate a cryptographically secure public ID.
 * Uses rejection sampling to eliminate modulo bias:
 * floor(256 / 36) * 36 = 252, so bytes >= 252 are rejected.
 */
export function generatePublicId(): string {
  const maxByte = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE; // 252
  const result: string[] = [];

  while (result.length < PUBLIC_ID_LENGTH) {
    const bytes = randomBytes(PUBLIC_ID_LENGTH - result.length + 4); // extra buffer
    for (const byte of bytes) {
      if (byte >= maxByte) continue; // reject biased bytes
      result.push(ALPHABET[byte % ALPHABET_SIZE]!);
      if (result.length === PUBLIC_ID_LENGTH) break;
    }
  }

  return result.join('');
}
