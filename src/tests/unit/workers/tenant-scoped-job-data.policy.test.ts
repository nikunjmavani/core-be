import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const WORKERS_ROOT = join(process.cwd(), 'src/domains');

/** Queues that intentionally process cross-tenant retention or observability samples. */
const TENANT_SCOPING_EXEMPT_QUEUE_NAME_PATTERNS = [
  /retention/i,
  /cleanup/i,
  /idempotency-cardinality/i,
  /dlq-depth/i,
  /mail\.worker/i,
  /stripe-webhook/i,
  /audit-export/i,
  /user-data-export/i,
] as const;

function collectWorkerFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectWorkerFiles(fullPath, collected);
      continue;
    }
    if (entry.endsWith('.worker.ts')) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function isTenantScopingExemptWorkerFile(filePath: string): boolean {
  return TENANT_SCOPING_EXEMPT_QUEUE_NAME_PATTERNS.some((pattern) => pattern.test(filePath));
}

describe('Worker tenant scoping policy', () => {
  const workerFiles = collectWorkerFiles(WORKERS_ROOT);

  it('requires organizationPublicId in job data for tenant-scoped delivery workers', () => {
    const violations: string[] = [];

    for (const filePath of workerFiles) {
      if (isTenantScopingExemptWorkerFile(filePath)) {
        continue;
      }

      const source = readFileSync(filePath, 'utf8');
      const referencesOrganizationPublicId = source.includes('organizationPublicId');
      if (!referencesOrganizationPublicId) {
        violations.push(filePath.replace(`${process.cwd()}/`, ''));
      }
    }

    expect(violations).toEqual([]);
  });
});
