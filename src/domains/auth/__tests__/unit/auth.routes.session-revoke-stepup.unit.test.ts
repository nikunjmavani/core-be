import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Regression for sec-A7 (Low): `DELETE /me/sessions` and `DELETE /me/sessions/:session_id` used
 * to require only `app.authenticate`. A holder of a stolen bearer could revoke every
 * other session of the legitimate user, kicking them out of their own browser long
 * enough to complete a transfer in another tab.
 *
 * Both routes now require `requireRecentStepUpPreHandler` (same gate used by
 * `mfa/enroll`, `mfa/:id` delete, `webauthn/register/*`, `me/auth-methods` create/
 * delete, `password/change`). After sec-A1, that gate cannot be opened by password
 * alone for MFA-enabled users — so a stolen-session attacker must also know the
 * second factor to disrupt session state.
 *
 * Tests against the source text of `auth.routes.ts` because registering the live
 * plugin in a unit test pulls in `@fastify/rate-limit`, `zod-type-provider`, and the
 * full DI surface — far beyond the scope of "does this route declare the right
 * preHandler". The relationship between source text and runtime behavior is direct:
 * the preHandler array is the only mechanism that wires the step-up check at the
 * route level, so the source-text assertion is sufficient as a regression guard.
 */
describe('auth.routes — DELETE /me/sessions requires recent step-up (sec-A7)', () => {
  const routesSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'auth.routes.ts'),
    'utf8',
  );

  it('DELETE /me/sessions registration includes requireRecentStepUpPreHandler', () => {
    // Match the `zodApplication.delete('/me/sessions', { ... })` block (no trailing slash
    // qualifier so it does not falsely match `/me/sessions/:session_id` below) and assert it
    // mentions the step-up preHandler.
    const blockPattern =
      /zodApplication\.delete\(\s*'\/me\/sessions'\s*,\s*\{[\s\S]*?\}\s*,\s*controller\./;
    const match = blockPattern.exec(routesSource);
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain('requireRecentStepUpPreHandler');
  });

  it('DELETE /me/sessions/:session_id registration includes requireRecentStepUpPreHandler', () => {
    const blockPattern =
      /zodApplication\.delete[^(]*\(\s*'\/me\/sessions\/:session_id'\s*,\s*\{[\s\S]*?\}\s*,\s*controller\./;
    const match = blockPattern.exec(routesSource);
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain('requireRecentStepUpPreHandler');
  });
});
