import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_READ_RATE_LIMIT } from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';

/**
 * The two plan-catalog routes are the domain's only UNAUTHENTICATED, database-backed surface.
 * Until the fix that accompanies this test they registered a `schema` block and no `config`
 * block at all — no preset, no per-route cap — falling back to the global limiter alone, while
 * every other billing route was capped (`WEBHOOK_RATE_LIMIT` on the webhook,
 * `ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT` on all eight subscription routes).
 *
 * Enforced textually against the route file, mirroring
 * `subscription-routes-rate-limit.policy.unit.test.ts`: Fastify's per-route `config` is buried
 * behind plugin encapsulation and cannot be read back from a built app.
 */
describe('plan routes rate-limit policy', () => {
  const routesPath = join(process.cwd(), 'src/domains/billing/sub-domains/plan/plan.routes.ts');
  const source = readFileSync(routesPath, 'utf8');

  function findRouteBlock(httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const PUBLIC_PLAN_ROUTES: Array<[string, string]> = [
    ['get', '/plans'],
    ['get', '/plans/:plan_id'],
  ];

  for (const [method, url] of PUBLIC_PLAN_ROUTES) {
    it(`${method.toUpperCase()} ${url} carries PUBLIC_READ_RATE_LIMIT`, () => {
      expect(findRouteBlock(method, url)).toContain('PUBLIC_READ_RATE_LIMIT.config');
    });
  }

  it('the plan routes are the only routes in this file — no uncapped sibling slipped in', () => {
    // A new route added to plan.routes.ts without a `config` block would reopen exactly the gap
    // this policy closes, so pin the file's route count alongside the presets.
    const registeredRoutes = source.match(/zodApplication\.(get|post|patch|put|delete)/g) ?? [];
    expect(registeredRoutes).toHaveLength(PUBLIC_PLAN_ROUTES.length);
  });

  it('PUBLIC_READ_RATE_LIMIT is IP-keyed on the default onRequest hook', () => {
    // These routes have no authenticated actor to key on, and the limiter must run before the
    // handler touches Postgres — so no `hook: 'preHandler'` override, unlike the authed presets.
    expect(typeof PUBLIC_READ_RATE_LIMIT.config.rateLimit.keyGenerator).toBe('function');
    expect(PUBLIC_READ_RATE_LIMIT.config.rateLimit).not.toHaveProperty('hook');
    expect(PUBLIC_READ_RATE_LIMIT.config.rateLimit.timeWindow).toBe(60_000);
    expect(PUBLIC_READ_RATE_LIMIT.config.rateLimit.max).toBeGreaterThan(0);
  });
});
