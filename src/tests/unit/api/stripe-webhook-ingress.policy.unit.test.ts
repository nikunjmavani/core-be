/**
 * Policy: Stripe webhook HTTP ingress must register stripeWebhookIngressPlugin before
 * the webhook route, and no billing route file may register a `/stripe/webhook` path
 * (the deprecated alias was removed; only the canonical `/webhook` remains).
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
  it('registers stripeWebhookIngressPlugin before the webhook route', () => {
    const source = readFileSync(STRIPE_WEBHOOK_ROUTES, 'utf8');

    expect(source).toContain('stripeWebhookIngressPlugin');

    // Patterns tolerate Biome line-wrapping of `.post(` arguments when the
    // schema block is large enough to force multi-line formatting.
    const ingressIndex = source.search(/await\s+stripeWebhookIngressPlugin\s*\(\s*app/);
    const postIndex = source.search(/zodApplication\.post\(\s*['"]\/webhook['"]/);

    expect(ingressIndex).toBeGreaterThanOrEqual(0);
    expect(postIndex).toBeGreaterThan(ingressIndex);
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
