import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  derivePkceCodeChallengeS256,
  generatePkceCodeVerifier,
} from '@/domains/auth/sub-domains/auth-method/oauth/oauth-pkce.js';

describe('oauth-pkce', () => {
  it('generatePkceCodeVerifier produces URL-safe base64 strings', () => {
    const verifier = generatePkceCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('derivePkceCodeChallengeS256 matches SHA-256 base64url', () => {
    const verifier = 'test-verifier-value-for-pkce-unit-test';
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(derivePkceCodeChallengeS256(verifier)).toBe(expected);
  });
});
