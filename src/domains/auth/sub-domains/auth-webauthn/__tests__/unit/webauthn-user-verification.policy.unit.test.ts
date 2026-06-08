import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * sec-r4-A2 regression — the WebAuthn options round-trip must require user
 * verification at every call site so a UV-incapable authenticator can never
 * complete an enrollment that subsequently fails verify forever.
 *
 * verifyRegistrationResponse and verifyAuthenticationResponse are both called
 * with `requireUserVerification: true` (lines ~171 / ~324). If any
 * `generateRegistrationOptions` or `generateAuthenticationOptions` call uses
 * `userVerification: 'preferred'` (or `'discouraged'`), the round-trip would
 * succeed but verify would always reject — silently bricking the credential.
 */
describe('webauthn user-verification policy (sec-r4-A2)', () => {
  const webauthnServicePath = join(
    process.cwd(),
    'src/domains/auth/sub-domains/auth-webauthn/webauthn.service.ts',
  );
  const source = readFileSync(webauthnServicePath, 'utf8');

  it('no `userVerification: "preferred"` or `"discouraged"` occurrence in webauthn.service.ts', () => {
    // Allowlist `'required'`; flag the unsafe values.
    expect(source).not.toMatch(/userVerification:\s*['"]preferred['"]/);
    expect(source).not.toMatch(/userVerification:\s*['"]discouraged['"]/);
  });

  it('every userVerification assignment uses "required"', () => {
    const matches = [...source.matchAll(/userVerification:\s*['"]([a-z]+)['"]/g)];
    expect(matches.length).toBeGreaterThanOrEqual(3); // registration, authentication, decoy
    for (const [, value] of matches) {
      expect(value).toBe('required');
    }
  });
});
