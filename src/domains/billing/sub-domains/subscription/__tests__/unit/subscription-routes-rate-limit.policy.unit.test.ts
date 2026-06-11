import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * route-#2 regression — every subscription MUTATION must carry the
 * ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT preset. Subscriptions were the only
 * mutating domain with no per-route rate limit, so a `subscription:manage`
 * holder (or hijacked session) could drive ~100 Stripe ops/min/IP (proration /
 * ledger churn). Enforced textually against the route file (Fastify per-route
 * `config` is buried behind plugin encapsulation).
 */
describe('subscription routes rate-limit policy (route-#2)', () => {
  const routesPath = join(
    process.cwd(),
    'src/domains/billing/sub-domains/subscription/subscription.routes.ts',
  );
  const source = readFileSync(routesPath, 'utf8');

  function findRouteBlock(httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Subscription routes use generic type params: zodApplication.post<{...}>('/url', {...
    const pattern = new RegExp(
      `zodApplication\\.${httpMethod}(?:<[^>]*>)?\\(\\s*'${escapedUrl}',\\s*\\{([\\s\\S]*?)\\n\\s*\\},`,
      'm',
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(`route block not found: ${httpMethod.toUpperCase()} ${urlLiteral}`);
    }
    return match[1] ?? '';
  }

  const MUTATIONS: Array<[string, string]> = [
    ['post', '/organizations/:id/subscriptions'],
    ['patch', '/organizations/:id/subscriptions/:subscriptionId'],
    ['post', '/organizations/:id/subscriptions/:subscriptionId/change-plan'],
    ['post', '/organizations/:id/subscriptions/:subscriptionId/cancel'],
    ['post', '/organizations/:id/subscriptions/:subscriptionId/resume'],
  ];

  for (const [method, url] of MUTATIONS) {
    it(`${method.toUpperCase()} ${url} carries ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT`, () => {
      expect(findRouteBlock(method, url)).toContain('ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config');
    });
  }

  it('the two READ routes are NOT required to carry the mutation cap', () => {
    // Sanity: list/get are reads; the policy targets mutations only.
    expect(findRouteBlock('get', '/organizations/:id/subscriptions')).not.toContain(
      'ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config',
    );
  });
});
