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
      // One service glob per domain with mutate targets — a target whose tests are not included
      // here scores ~0 tests per mutant while looking configured (the user-domain latent bug,
      // which audit/notify/upload then reproduced by adding targets without their globs).
      'src/domains/audit/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/auth/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/billing/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/notify/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/tenancy/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/upload/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/user/**/__tests__/unit/*service*.unit.test.ts',
      // The mutate list also carries two non-service targets; their suites match these patterns.
      'src/domains/audit/**/__tests__/unit/*processor*.unit.test.ts', // audit-retention.processor.ts
      'src/domains/notify/**/__tests__/unit/**/*worker*.unit.test.ts', // webhook-delivery.worker.ts
      'src/tests/unit/middleware/**/*.unit.test.ts',
    ],
    // `*.db.unit.test.ts` needs a live Postgres and breaks Stryker's dry run — the pattern above
    // would otherwise sweep in e.g. user-data-export.service.db.unit.test.ts.
    exclude: ['**/*.db.unit.test.ts'],
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
