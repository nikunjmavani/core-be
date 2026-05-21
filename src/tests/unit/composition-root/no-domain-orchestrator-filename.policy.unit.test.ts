/**
 * Policy: billing subscription Stripe integration uses `StripePaymentProvider`
 * (`stripe-payment-provider.ts`), not an orchestrator-named module.
 *
 * Backs plan #56 (`p2-rename-orchestrator`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

function collectDomainSourceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectDomainSourceFiles(fullPath, accumulator);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      accumulator.push(relative(PROJECT_ROOT, fullPath));
    }
  }
  return accumulator;
}

const DOMAIN_SOURCE_FILES = collectDomainSourceFiles(DOMAINS_ROOT);

describe('Policy: no orchestrator-named billing modules under src/domains', () => {
  it('has no file path containing "orchestrator" under src/domains', () => {
    const orchestratorPaths = DOMAIN_SOURCE_FILES.filter((filePath) =>
      filePath.toLowerCase().includes('orchestrator'),
    );
    expect(orchestratorPaths).toEqual([]);
  });

  it('does not reference SubscriptionStripeOrchestrator or subscription-stripe.orchestrator', () => {
    const offenders: string[] = [];
    for (const filePath of DOMAIN_SOURCE_FILES) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      if (
        source.includes('SubscriptionStripeOrchestrator') ||
        source.includes('subscription-stripe.orchestrator')
      ) {
        offenders.push(filePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('subscription service uses PaymentProvider port (not orchestrator-named modules)', () => {
    const subscriptionServicePath = join(
      PROJECT_ROOT,
      'src/domains/billing/sub-domains/subscription/subscription.service.ts',
    );
    const source = readFileSync(subscriptionServicePath, 'utf8');
    expect(source).toMatch(/PaymentProvider/);
    expect(source).not.toMatch(/orchestrator/i);
    expect(source).not.toMatch(/StripeSubscriptionAdapter/);
  });
});
