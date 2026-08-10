import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Smoke specs drive a LIVE server over HTTP, so the root Vitest config excludes
 * `src/tests/smoke/**` from the default graph.
 *
 * A `smoke` project inside that config cannot work: `extends: true` inherits the root
 * `exclude`, which overrides the project's own `include`, so the project matches no
 * files and reports "No test files found". Chaos and contract avoid this by running
 * from dedicated config files — smoke had none, and no `test:smoke` script existed, so
 * five specs were unreachable by any command. This file is that dedicated config.
 *
 * Requires a running server (`pnpm dev`) and seeded demo data (`pnpm db:seed:full`).
 */
export default defineConfig({
  root: projectRoot,
  test: {
    globals: true,
    include: ['src/tests/smoke/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    // Serial: every spec drives the same live server and shared seeded data.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
      '@tooling': resolve(projectRoot, 'tooling'),
    },
  },
});
