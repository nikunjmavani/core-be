/**
 * Policy: webhook-delivery.worker.ts must not import a Drizzle DB schema (only Zod job schemas
 * and the repository class are permitted). Worker DB writes go through
 * `WebhookDeliveryAttemptRepository` per plan #52 (`p2-webhook-worker-repo`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKER_PATH = join(
  process.cwd(),
  'src/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.ts',
);

describe('Policy: webhook-delivery worker uses repository, not Drizzle schema', () => {
  const source = readFileSync(WORKER_PATH, 'utf8');

  it('does not import any Drizzle DB schema file (*.schema.js excluding job/dlq schemas)', () => {
    const importLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('import ') && line.includes('.schema'));

    const drizzleSchemaImports = importLines.filter((line) => {
      const lower = line.toLowerCase();
      const isJobOrZodSchema =
        lower.includes('job.schema') || lower.includes('dlq') || lower.includes('zod');
      return !isJobOrZodSchema;
    });

    expect(drizzleSchemaImports).toEqual([]);
  });

  it('imports WebhookDeliveryAttemptRepository (single repo for delivery writes)', () => {
    expect(source).toMatch(/WebhookDeliveryAttemptRepository/);
  });

  it('does not import drizzle-orm directly (no raw queries)', () => {
    const importsDrizzleOrm = /from\s+['"]drizzle-orm['"]/.test(source);
    expect(importsDrizzleOrm).toBe(false);
  });
});
