import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  formatSessionCookieValue,
  generateCsrfToken,
  generateRefreshSecret,
  parseSessionCookieValue,
} from '@/domains/auth/auth.http.util.js';
import {
  generateMfaRecoveryCode,
  generateMfaRecoveryCodes,
} from '@/domains/auth/sub-domains/auth-mfa/auth-mfa-recovery-code.util.js';
import { MFA_RECOVERY_CODE_LENGTH } from '@/shared/constants/ttl.constants.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

/**
 * Layer 2 (property) for auth's security primitives — the values defined by a *rule*, not an
 * enumerable set: the `<sessionPublicId>.<refreshSecret>` cookie encoding, the CSRF/refresh token
 * generators, and the MFA recovery-code alphabet. The example suites pin specific inputs; these
 * pin the rule over thousands, so a codec that is accidentally widened (a parser that starts
 * accepting an empty secret half, a generator that shrinks its charset) fails here first.
 */

/** Session public ids: prefix + 21 lowercase alphanumerics — never contains the separator. */
const sessionPublicId = fc.stringMatching(/^[a-z0-9]{21}$/).map((suffix) => `ses_${suffix}`);

/** Any non-empty secret. The parser splits on the FIRST dot, so secrets may contain dots. */
const refreshSecret = fc.string({ minLength: 1, maxLength: 128 }).filter((s) => s.length > 0);

describe('session cookie value (property)', () => {
  it('round-trips format → parse for any id/secret pair, even when the secret contains dots', () => {
    fc.assert(
      fc.property(sessionPublicId, refreshSecret, (id, secret) => {
        const parsed = parseSessionCookieValue(formatSessionCookieValue(id, secret));
        expect(parsed).toEqual({ sessionPublicId: id, refreshSecret: secret });
      }),
      propertyOptions,
    );
  });

  it('never throws on arbitrary input, and never returns a value with an empty half', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 256 }), (raw) => {
        const parsed = parseSessionCookieValue(raw);
        if (parsed !== null) {
          // A parse that ever yields an empty session id or secret would send an empty
          // credential into the session lookup instead of refusing the cookie outright.
          expect(parsed.sessionPublicId.length).toBeGreaterThan(0);
          expect(parsed.refreshSecret.length).toBeGreaterThan(0);
          expect(raw).toBe(formatSessionCookieValue(parsed.sessionPublicId, parsed.refreshSecret));
        }
      }),
      propertyOptions,
    );
  });

  it('rejects exactly the malformed shapes: no separator, leading separator, or empty secret', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9_]{1,40}$/), (dotless) => {
        // No separator at all → legacy shape → null.
        expect(parseSessionCookieValue(dotless)).toBeNull();
        // Separator at index 0 → empty id half → null.
        expect(parseSessionCookieValue(`.${dotless}`)).toBeNull();
        // Trailing separator → empty secret half → null.
        expect(parseSessionCookieValue(`${dotless}.`)).toBeNull();
      }),
      propertyOptions,
    );
  });
});

describe('CSRF and refresh-secret generators (property)', () => {
  it('emits URL-safe base64url of the expected length, with no collisions across a batch', () => {
    const csrfTokens = Array.from({ length: 200 }, () => generateCsrfToken());
    const refreshSecrets = Array.from({ length: 200 }, () => generateRefreshSecret());

    for (const value of [...csrfTokens, ...refreshSecrets]) {
      // 32 random bytes → 43 base64url chars, alphabet [A-Za-z0-9_-] — cookie- and URL-safe
      // without encoding. A `+`, `/`, or `=` here means someone switched to plain base64.
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(new Set(csrfTokens).size).toBe(200);
    expect(new Set(refreshSecrets).size).toBe(200);
  });
});

describe('MFA recovery codes (property)', () => {
  const AMBIGUOUS_CHARACTERS = /[0O1IL]/;

  it('every generated code has the exact length and never contains a visually ambiguous character', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const code = generateMfaRecoveryCode();
        expect(code).toHaveLength(MFA_RECOVERY_CODE_LENGTH);
        expect(code).toMatch(/^[A-Z2-9]+$/);
        // The alphabet deliberately drops 0/O, 1/I/L — a support agent reading a code
        // aloud must never have to guess.
        expect(code).not.toMatch(AMBIGUOUS_CHARACTERS);
      }),
      propertyOptions,
    );
  });

  it('honours any requested count exactly, with all codes distinct — including zero', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 16 }), (count) => {
        const codes = generateMfaRecoveryCodes(count);
        expect(codes).toHaveLength(count);
        expect(new Set(codes).size).toBe(count);
      }),
      propertyOptions,
    );
  });

  it('two independently generated batches never intersect', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (count) => {
        const first = new Set(generateMfaRecoveryCodes(count));
        for (const code of generateMfaRecoveryCodes(count)) {
          // A collision across batches at 60 bits/code means the CSPRNG path was replaced
          // with something deterministic.
          expect(first.has(code)).toBe(false);
        }
      }),
      propertyOptions,
    );
  });
});
