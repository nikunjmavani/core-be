import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * sec-r4-I1 regression — every authenticated self-service mutation under
 * /api/v1/users/me must carry a rate-limit preset so a hijacked session
 * cannot churn writes against profile/settings/preferences/avatar/account.
 *
 * The policy is enforced textually against the route file rather than at
 * runtime because Fastify's per-route `config` is buried behind plugin
 * encapsulation; a single-source assertion is sufficient and impossible
 * to silently regress (the next reviewer of user.routes.ts sees the
 * comment trail explaining the cap).
 */
describe('user routes rate-limit policy (sec-r4-I1)', () => {
  const userRoutesPath = join(process.cwd(), 'src/domains/user/user.routes.ts');
  const source = readFileSync(userRoutesPath, 'utf8');

  // Match the block immediately following each route registration so an
  // attacker can't quietly drop a preset on one path while leaving the rest.
  function findRouteBlock(httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `zodApplication\\.${httpMethod}\\(\\s*'${escapedUrl}',\\s*\\{([\\s\\S]*?)\\n\\s*\\},`,
      'm',
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(`route block not found: ${httpMethod.toUpperCase()} ${urlLiteral}`);
    }
    return match[1] ?? '';
  }

  it('PATCH /me has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('patch', '/me')).toContain('...MODERATE_AUTHED_RATE_LIMIT');
  });

  it('DELETE /me has EXPENSIVE_AUTHED_RATE_LIMIT applied (irreversible)', () => {
    expect(findRouteBlock('delete', '/me')).toContain('...EXPENSIVE_AUTHED_RATE_LIMIT');
  });

  it('PATCH /me/settings has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('patch', '/me/settings')).toContain('...MODERATE_AUTHED_RATE_LIMIT');
  });

  it('PUT /me/notification-preferences has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('put', '/me/notification-preferences')).toContain(
      '...MODERATE_AUTHED_RATE_LIMIT',
    );
  });

  it('PUT /me/avatar has MODERATE_AUTHED_RATE_LIMIT applied (S3 write)', () => {
    expect(findRouteBlock('put', '/me/avatar')).toContain('...MODERATE_AUTHED_RATE_LIMIT');
  });

  it('DELETE /me/avatar has MODERATE_AUTHED_RATE_LIMIT applied (S3 delete)', () => {
    expect(findRouteBlock('delete', '/me/avatar')).toContain('...MODERATE_AUTHED_RATE_LIMIT');
  });

  // route-#4: the ADMIN user-management mutations were the only authed mutations with no
  // per-route cap — a compromised admin token could bulk-edit/delete/suspend accounts.
  it('PATCH /:user_id (admin) has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('patch', '/:user_id')).toContain('...MODERATE_AUTHED_RATE_LIMIT');
  });

  it('DELETE /:user_id (admin) has EXPENSIVE_AUTHED_RATE_LIMIT applied (destructive)', () => {
    expect(findRouteBlock('delete', '/:user_id')).toContain('...EXPENSIVE_AUTHED_RATE_LIMIT');
  });

  it('POST /:user_id/suspend (admin) has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('post', '/:user_id/suspend')).toContain('...MODERATE_AUTHED_RATE_LIMIT');
  });

  it('POST /:user_id/unsuspend (admin) has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('post', '/:user_id/unsuspend')).toContain(
      '...MODERATE_AUTHED_RATE_LIMIT',
    );
  });
});
