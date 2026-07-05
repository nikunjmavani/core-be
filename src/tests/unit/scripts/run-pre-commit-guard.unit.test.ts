import { describe, expect, it } from 'vitest';
import {
  buildGuardSteps,
  hasPackageScript,
  shouldRunGlobalTests,
  shouldRunMigrationCheck,
  shouldRunOpenApiCheck,
  shouldRunSonarScan,
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

  it('runs the global suite for domains, env-schema, harness, workflows, and Docker changes', () => {
    expect(shouldRunGlobalTests(['src/domains/auth/auth.service.ts'])).toBe(true);
    // env-driven-config guard surfaces (no-nodeenv-branching.global.test.ts scans these).
    expect(shouldRunGlobalTests(['src/shared/config/env-schema.ts'])).toBe(true);
    expect(shouldRunGlobalTests(['src/tests/setup.ts'])).toBe(true);
    expect(shouldRunGlobalTests(['src/tests/chaos/bootstrap-env.ts'])).toBe(true);
    expect(shouldRunGlobalTests(['.github/workflows/pr-ci.yml'])).toBe(true);
    expect(shouldRunGlobalTests(['Dockerfile'])).toBe(true);
    expect(shouldRunGlobalTests(['docker-compose.yml'])).toBe(true);
    // Unrelated files do not trigger the global suite.
    expect(shouldRunGlobalTests(['docs/README.md'])).toBe(false);
    expect(shouldRunGlobalTests(['src/shared/utils/text/slug.util.ts'])).toBe(false);
  });

  it('detects deployed-surface staged paths for the SonarQube gate', () => {
    expect(shouldRunSonarScan(['src/domains/auth/auth.service.ts'])).toBe(true);
    expect(shouldRunSonarScan(['src/shared/utils/http/response.util.ts'])).toBe(true);
    // Tests, scripts, and tooling are excluded from Sonar analysis.
    expect(shouldRunSonarScan(['src/domains/auth/__tests__/auth.test.ts'])).toBe(false);
    expect(shouldRunSonarScan(['src/domains/auth/auth.service.test.ts'])).toBe(false);
    expect(shouldRunSonarScan(['src/tests/unit/scripts/run-pre-commit-guard.unit.test.ts'])).toBe(
      false,
    );
    expect(shouldRunSonarScan(['src/scripts/tooling/run-pre-commit-guard.ts'])).toBe(false);
    expect(shouldRunSonarScan(['tooling/sonar/sonar-gate.ts'])).toBe(false);
    expect(shouldRunSonarScan(['docs/README.md'])).toBe(false);
  });

  it('marks the SonarQube step always/conditional based on staged runtime code', () => {
    const withRuntime = buildGuardSteps({
      stagedFiles: ['src/domains/auth/auth.service.ts'],
      scripts: baseScripts,
    });
    expect(withRuntime.find((step) => step.id === '17')?.when).toBe('always');

    const withoutRuntime = buildGuardSteps({
      stagedFiles: ['docs/README.md'],
      scripts: baseScripts,
    });
    expect(withoutRuntime.find((step) => step.id === '17')?.when).toBe('conditional');
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
