import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * sec-r5-followup-tc-3 regression — every credential-sensitive auth / MFA /
 * WebAuthn route MUST carry `STRICT_AUTHED_RATE_LIMIT` so a hijacked session
 * cannot churn password / MFA / passkey operations. The Round 5 preset-shape
 * test in `preset-authed-burst.security.test.ts` covers the PRESET; this test
 * covers the per-route APPLICATION. A future routes refactor that quietly
 * drops `...STRICT_AUTHED_RATE_LIMIT` from one of these specific entries
 * would fail here.
 *
 * Mirrors the policy-test pattern from sec-r4-I1/I2/I3
 * (`*-routes-rate-limit.policy.unit.test.ts`).
 */
describe('auth routes rate-limit policy (sec-r5-followup-tc-3)', () => {
  const authRoutesPath = join(process.cwd(), 'src/domains/auth/auth.routes.ts');
  const source = readFileSync(authRoutesPath, 'utf8');

  function findRouteBlock(httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match `zodApplication.<method>('<url>', { ... }`. Allow optional generic
    // params after the method (e.g. `zodApplication.delete<{ Params: ... }>`).
    const pattern = new RegExp(
      `zodApplication\\.${httpMethod}(?:<[^>]*>)?\\(\\s*'${escapedUrl}',\\s*\\{([\\s\\S]*?)\\n\\s{4,6}\\},\\n\\s{4,6}\\w`,
      'm',
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(`route block not found: ${httpMethod.toUpperCase()} ${urlLiteral}`);
    }
    return match[1] ?? '';
  }

  const STRICT_AUTHED_ROUTES: Array<{ method: string; url: string; description: string }> = [
    { method: 'post', url: '/password/change', description: 'authenticated password change' },
    { method: 'post', url: '/step-up', description: 'recent-step-up re-auth' },
    { method: 'post', url: '/email/resend-verification', description: 'resend email verification' },
    { method: 'post', url: '/mfa/enroll', description: 'MFA enrollment phase 1' },
    {
      method: 'post',
      url: '/mfa/enroll/confirm',
      description: 'MFA enrollment phase 2 (returns recovery codes)',
    },
    { method: 'post', url: '/webauthn/register/options', description: 'WebAuthn register options' },
    { method: 'post', url: '/webauthn/register/verify', description: 'WebAuthn register verify' },
  ];

  for (const route of STRICT_AUTHED_ROUTES) {
    it(`${route.method.toUpperCase()} ${route.url} has STRICT_AUTHED_RATE_LIMIT applied (${route.description})`, () => {
      const block = findRouteBlock(route.method, route.url);
      expect(block).toContain('...STRICT_AUTHED_RATE_LIMIT');
    });
  }
});
