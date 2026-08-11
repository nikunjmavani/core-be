import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import baseConfig from './base.js';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Smoke specs exercise the API end to end, so the root Vitest config excludes
 * `src/tests/smoke/**` from the default graph.
 *
 * A `smoke` project inside that config cannot work: `extends: true` inherits the root
 * `exclude`, which overrides the project's own `include`, so the project matches no
 * files and reports "No test files found". Chaos and contract avoid this by running
 * from dedicated config files — smoke had none, and no `test:smoke` script existed, so
 * five specs were unreachable by any command. This file is that dedicated config.
 *
 * Spreads `baseConfig` (the same idiom as `chaos.config.ts`) for `globalSetup` and
 * `setupFiles`. Without them no `.env` file is ever loaded and every spec dies at
 * import with "Missing or invalid environment variables" — the reason this tier
 * reported "no tests" rather than a pass.
 *
 * Runs in-process through `fastify.inject()` against the local Postgres/Redis, so it
 * needs the same harness env as every other database-backed tier. Set
 * `SMOKE_EXTERNAL=true` to drive a live server over real HTTP instead
 * (`pnpm dev` + `pnpm db:seed:full`, honouring `SMOKE_BASE_URL`).
 */
export default defineConfig({
  ...baseConfig,
  root: projectRoot,
  test: {
    ...baseConfig.test,
    include: ['src/tests/smoke/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    // Serial: every spec drives the same app instance and shared seeded data.
    fileParallelism: false,
  },
});
