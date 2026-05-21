import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * Narrow Vitest surface for `pnpm test:mutation` (Stryker).
 * Only service unit tests for mutated domains plus middleware unit tests —
 * excludes controllers, repositories, and integration tests that break the dry run.
 */
export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: [
      'src/domains/auth/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/billing/**/__tests__/unit/*service*.unit.test.ts',
      'src/domains/tenancy/**/__tests__/unit/*service*.unit.test.ts',
      'src/tests/unit/middleware/**/*.unit.test.ts',
    ],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@': resolve(configurationDirectory, 'src'),
    },
  },
  server: {
    deps: {
      external: ['stripe', 'resend', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
    },
  },
});
