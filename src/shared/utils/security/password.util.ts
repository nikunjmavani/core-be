import argon2 from 'argon2';

/**
 * Password hashing utility — uses Argon2id (OWASP recommended).
 *
 * Argon2id parameters follow OWASP 2024 recommendations:
 *   memoryCost: 19456 KiB (~19 MB), timeCost: 2, parallelism: 1
 */

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456, // ~19 MB (OWASP recommended minimum)
  timeCost: 2,
  parallelism: 1,
};

/**
 * Precomputed Argon2id hash (of a fixed, non-secret sentinel value) used to
 * equalize login timing. When a login is attempted for an email with no user
 * or no stored password, callers verify the supplied password against this
 * dummy hash and discard the result, so the response time matches the
 * password-mismatch path and cannot be used to enumerate valid emails.
 *
 * @remarks
 * Generated with {@link ARGON2_OPTIONS}; it never validates any real password.
 */
export const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$DesFxz144SQTxwQTYSQixw$yURO8nyJ9JO7gWawKpX+uutayJl5m6m2DkvWIp2kHiM';

/**
 * Hash a password with Argon2id.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a password against a stored Argon2id hash.
 * Returns `needsRehash` when Argon2 parameters should be upgraded.
 */
export async function verifyPassword(
  plaintext: string,
  storedHash: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!storedHash.startsWith('$argon2')) {
    return { valid: false, needsRehash: false };
  }
  const valid = await argon2.verify(storedHash, plaintext, ARGON2_OPTIONS);
  const needsRehash = valid ? argon2.needsRehash(storedHash, ARGON2_OPTIONS) : false;
  return { valid, needsRehash };
}
