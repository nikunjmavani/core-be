import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 PKCE code verifier (43–128 chars, unreserved). */
export function generatePkceCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 code challenge from verifier: BASE64URL(SHA256(verifier)). */
export function derivePkceCodeChallengeS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}
