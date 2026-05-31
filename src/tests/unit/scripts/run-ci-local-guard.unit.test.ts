import { describe, expect, it } from 'vitest';
import { formatCiLocalStepLabel, readCiLocalSteps } from '@/scripts/tooling/run-ci-local-guard.js';

describe('run-ci-local-guard', () => {
  it('parses chained ci:local steps from package scripts', () => {
    const steps = readCiLocalSteps({
      'ci:local': 'pnpm validate && pnpm test && pnpm build',
    });
    expect(steps).toEqual(['pnpm validate', 'pnpm test', 'pnpm build']);
  });

  it('throws when ci:local script is missing', () => {
    expect(() => readCiLocalSteps({})).toThrow('Missing package.json script: ci:local');
  });

  it('strips pnpm prefix for step labels', () => {
    expect(formatCiLocalStepLabel('pnpm validate')).toBe('validate');
    expect(formatCiLocalStepLabel('node tooling/ci/check-action-pins.mjs')).toBe(
      'node tooling/ci/check-action-pins.mjs',
    );
  });

  it('includes validate:domain:unit-matrix in the real ci:local chain', () => {
    const steps = readCiLocalSteps();
    expect(steps.some((step) => step.includes('validate:domain:unit-matrix'))).toBe(true);
  });
});
