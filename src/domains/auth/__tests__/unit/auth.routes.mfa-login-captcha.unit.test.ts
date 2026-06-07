import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Regression for sec-new-A1 (Medium): `POST /mfa/login` was missing
 * `captchaPreHandler` that every other public credential endpoint has.
 *
 * The `mfa_session_token` is single-use (`GETDEL`) so per-email rate-limiting
 * is already enforced at `POST /auth/login` (which mints the token). Captcha
 * adds a second friction layer against automated TOTP guessing from accumulated
 * tokens without requiring the bot to re-solve per brute-force attempt.
 *
 * Tests against the source text of `auth.routes.ts` — same justification as the
 * `auth.routes.session-revoke-stepup.unit.test.ts` companion: the `preHandler`
 * array is the only mechanism that wires the check at route level, so a
 * source-text assertion is a sufficient and cheap regression guard.
 */
describe('auth.routes — POST /mfa/login requires captchaPreHandler (sec-new-A1)', () => {
  const routesSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'auth.routes.ts'),
    'utf8',
  );

  it('POST /mfa/login registration includes captchaPreHandler', () => {
    // Match the full `zodApplication.post('/mfa/login', { ... }, controller.verifyMfaLogin)` block.
    const blockPattern =
      /zodApplication\.post\(\s*'\/mfa\/login'\s*,\s*\{[\s\S]*?\}\s*,\s*controller\.verifyMfaLogin/;
    const match = blockPattern.exec(routesSource);
    expect(match, 'POST /mfa/login route block not found').not.toBeNull();
    expect(match?.[0]).toContain('captchaPreHandler');
  });
});
