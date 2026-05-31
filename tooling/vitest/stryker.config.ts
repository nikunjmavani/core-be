import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Narrow Vitest surface for `pnpm test:mutation` (Stryker).
 * Only service unit tests for mutated domains plus middleware unit tests —
 * excludes controllers, repositories, and integration tests that break the dry run.
 */
export default defineConfig({
  root: projectRoot,
  test: {
    globals: true,
    setupFiles: [resolve(projectRoot, 'src/tests/setup.ts')],
    include: [
      'src/domains/auth/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/billing/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/tenancy/**/__tests__/unit/*service*.unit.test.ts',
      'src/tests/unit/middleware/**/*.unit.test.ts',
    ],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
      '@tooling': resolve(projectRoot, 'tooling'),
    },
  },
});
