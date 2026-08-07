import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROPERTY_TEST_NUM_RUNS,
  propertyAssertOptions,
} from '@/tests/helpers/fast-check-property.util.js';
import { vitestProjects } from '@tooling/vitest/projects.js';

const propertyTestFiles = [
  'src/tests/unit/validators/idempotency-key.property.unit.test.ts',
  'src/tests/unit/validators/pagination-schema.property.unit.test.ts',
  'src/tests/unit/validators/uuid-schema.property.unit.test.ts',
  'src/tests/unit/property-based/idempotency-cache-key.property.unit.test.ts',
  'src/tests/unit/property-based/webhook-signature.property.unit.test.ts',
  'src/tests/unit/property-based/billing-money.property.unit.test.ts',
];

describe('fast-check property testing policy (#69)', () => {
  it('defines more than five property test suites with shared shrink budget', () => {
    expect(propertyTestFiles.length).toBeGreaterThan(5);
    const options = propertyAssertOptions();
    expect(options.endOnFailure).toBe(true);
    expect(options.maxSkipsPerRun).toBe(100);
    expect(PROPERTY_TEST_NUM_RUNS).toBeGreaterThan(0);
  });

  it('runs property tests in CI quality gate with bounded numRuns', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['test:property']).toContain('--project property');
    expect(packageJson.scripts['ci:quality']).toContain('pnpm test:property');

    // Read the config, don't grep its source: asserting on `name: 'property'` as
    // text made this fail the moment a formatter switched the file to double
    // quotes — a green-to-red with nothing actually broken.
    const projectNames = vitestProjects.map(
      (project) => (project as { test?: { name?: string } }).test?.name,
    );
    expect(projectNames).toContain('property');

    const prCi = readFileSync(join(process.cwd(), '.github/workflows/pr-ci.yml'), 'utf8');
    expect(prCi).toContain('pnpm test:property');
    expect(prCi).toContain('FAST_CHECK_NUM_RUNS');
  });

  it('uses shared propertyAssertOptions in every property suite', () => {
    for (const relativePath of propertyTestFiles) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
      expect(source).toContain('propertyAssertOptions');
    }
  });
});
