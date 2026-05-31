import { describe, expect, it } from 'vitest';
import {
  buildGuardSteps,
  hasPackageScript,
  shouldRunMigrationCheck,
  shouldRunOpenApiCheck,
  shouldRunStructureTreeCheck,
} from '@/scripts/tooling/run-pre-commit-guard.js';

describe('run-pre-commit-guard conditionals', () => {
  const baseScripts = {
    'tool:project-structure-tree': 'tsx src/scripts/codegen/generate-project-structure-tree.ts',
    'validate:test-naming': 'tsx src/scripts/validators/tests/validate-test-naming.ts',
  };

  it('detects OpenAPI-related staged paths', () => {
    expect(shouldRunOpenApiCheck(['src/domains/auth/auth.service.ts'])).toBe(false);
    expect(
      shouldRunOpenApiCheck(['src/domains/auth/sub-domains/auth-session/auth-session.routes.ts']),
    ).toBe(true);
    expect(shouldRunOpenApiCheck(['src/shared/locales/en/openapi.json'])).toBe(true);
  });

  it('detects migration and structure-tree staged paths', () => {
    expect(shouldRunMigrationCheck(['migrations/20260531000001_test.sql'])).toBe(true);
    expect(shouldRunMigrationCheck(['src/domains/auth/auth.routes.ts'])).toBe(false);
    expect(shouldRunStructureTreeCheck(['src/domains/auth/auth.routes.ts'])).toBe(true);
    expect(shouldRunStructureTreeCheck(['tooling/ci/run-named-step.sh'])).toBe(true);
    expect(shouldRunStructureTreeCheck(['docs/README.md'])).toBe(false);
  });

  it('includes optional steps only when package scripts exist', () => {
    expect(hasPackageScript(baseScripts, 'validate:test-naming')).toBe(true);
    expect(hasPackageScript(baseScripts, 'tool:project-structure-tree:check')).toBe(false);

    const stepsWithoutCheck = buildGuardSteps({
      stagedFiles: ['src/domains/auth/auth.routes.ts'],
      scripts: baseScripts,
    });
    expect(stepsWithoutCheck.some((step) => step.id === '9')).toBe(true);
    expect(stepsWithoutCheck.some((step) => step.id === '6c')).toBe(false);

    const stepsWithCheck = buildGuardSteps({
      stagedFiles: ['docs/README.md'],
      scripts: {
        ...baseScripts,
        'tool:project-structure-tree:check':
          'tsx src/scripts/codegen/generate-project-structure-tree.ts --check',
      },
    });
    expect(stepsWithCheck.some((step) => step.id === '6c')).toBe(true);
  });

  it('omits validate:test-naming when script is missing', () => {
    const steps = buildGuardSteps({
      stagedFiles: [],
      scripts: { 'tool:project-structure-tree': 'tsx ...' },
    });
    expect(steps.some((step) => step.id === '9')).toBe(false);
  });
});
