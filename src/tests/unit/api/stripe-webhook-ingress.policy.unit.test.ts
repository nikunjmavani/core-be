/**
 * Policy: Stripe webhook HTTP ingress must register stripeWebhookIngressPlugin before
 * any handler under /stripe, and billing must not register /stripe/webhook outside
 * stripe-webhook.routes.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const BILLING_DOMAIN_ROOT = join(PROJECT_ROOT, 'src/domains/billing');
const STRIPE_WEBHOOK_ROUTES = join(
  BILLING_DOMAIN_ROOT,
  'sub-domains/stripe-webhook/stripe-webhook.routes.ts',
);

function collectBillingRouteFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectBillingRouteFiles(fullPath, collected);
      continue;
    }
    if (entry.endsWith('.routes.ts')) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function relativePath(absolutePath: string): string {
  return absolutePath.replace(`${PROJECT_ROOT}/`, '');
}

describe('Stripe webhook ingress policy', () => {
  it('registers stripeWebhookIngressPlugin before POST /webhook under /stripe prefix', () => {
    const source = readFileSync(STRIPE_WEBHOOK_ROUTES, 'utf8');

    expect(source).toContain('stripeWebhookIngressPlugin');
    expect(source).toMatch(/prefix:\s*['"]\/stripe['"]/);

    const ingressIndex = source.indexOf('await stripeWebhookIngressPlugin(app');
    const postIndex = source.indexOf("zodApplication.post('/webhook'");
    const legacyIngressIndex = source.indexOf(
      'await stripeRoutes.register(stripeWebhookIngressPlugin)',
    );
    const legacyPostIndex = source.indexOf("stripeZodApplication.post('/webhook'");

    expect(ingressIndex).toBeGreaterThanOrEqual(0);
    expect(postIndex).toBeGreaterThan(ingressIndex);
    expect(legacyIngressIndex).toBeGreaterThanOrEqual(0);
    expect(legacyPostIndex).toBeGreaterThan(legacyIngressIndex);
  });

  it('does not register /stripe/webhook directly in other billing route files', () => {
    const violations: string[] = [];
    const stripeWebhookRoutesRelative = relativePath(STRIPE_WEBHOOK_ROUTES);

    for (const absolutePath of collectBillingRouteFiles(BILLING_DOMAIN_ROOT)) {
      const relative = relativePath(absolutePath);
      if (relative === stripeWebhookRoutesRelative) {
        continue;
      }

      const source = readFileSync(absolutePath, 'utf8');
      if (source.includes('/stripe/webhook')) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });
});
