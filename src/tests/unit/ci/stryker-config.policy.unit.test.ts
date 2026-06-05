import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strykerConfigPath = join(process.cwd(), 'stryker.config.json');
const workflowPath = join(process.cwd(), '.github/workflows/scheduled-stryker-mutation.yml');
const vitestStrykerPath = join(process.cwd(), 'tooling/vitest/stryker.config.ts');

describe('Stryker mutation testing policy (#68)', () => {
  it('enforces 70% break threshold on auth, billing, tenancy, and security middleware', () => {
    const config = JSON.parse(readFileSync(strykerConfigPath, 'utf8')) as {
      mutate: string[];
      thresholds: { break: number; high: number };
      testRunner: string;
    };

    expect(config.testRunner).toBe('vitest');
    expect(config.thresholds.break).toBe(70);
    expect(config.thresholds.high).toBe(80);
    expect(config.mutate.some((pattern) => pattern.includes('domains/auth'))).toBe(true);
    expect(config.mutate.some((pattern) => pattern.includes('domains/billing'))).toBe(true);
    expect(config.mutate.some((pattern) => pattern.includes('domains/tenancy'))).toBe(true);
    expect(
      config.mutate.some((pattern) => pattern.includes('middlewares/core/auth.middleware.ts')),
    ).toBe(true);
    expect(
      config.mutate.some((pattern) =>
        pattern.includes('middlewares/security/api-key-auth.middleware.ts'),
      ),
    ).toBe(true);
  });

  it('wires nightly workflow with artifact upload', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('pnpm test:mutation');
    expect(workflow).toContain('mutation-report.json');
    expect(workflow).toContain("cron: '30 3 * * 0'");
  });

  it('limits vitest to service and middleware unit tests for mutation dry run', () => {
    const vitestConfig = readFileSync(vitestStrykerPath, 'utf8');
    expect(vitestConfig).toContain('*service*.unit.test.ts');
    expect(vitestConfig).toContain('src/tests/unit/middleware');
    expect(vitestConfig).not.toContain('src/domains/auth/**/*.unit.test.ts');
  });
});
