/**
 * Policy: Stripe webhook HTTP ingress must register stripeWebhookIngressPlugin before
 * the `/webhook` handler, and the removed `/stripe/webhook` deprecated alias must not
 * be re-introduced in any billing route file.
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

  it('does not re-introduce the removed /stripe/webhook alias in any billing route file', () => {
    const violations: string[] = [];

    for (const absolutePath of collectBillingRouteFiles(BILLING_DOMAIN_ROOT)) {
      const source = readFileSync(absolutePath, 'utf8');
      if (source.includes('/stripe/webhook')) {
        violations.push(relativePath(absolutePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
