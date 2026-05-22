import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.base.js';
import { vitestProjects } from './tooling/vitest/projects.js';
import coverageThresholds from './tooling/ci/coverage-thresholds.json' with { type: 'json' };

/**
 * Root Vitest config — composes shared settings from `vitest.base.ts` with the
 * named projects defined in `tooling/vitest/projects.ts` (parallel-safe pure
 * unit + sequential DB-bound tiers, etc.).
 *
 * Run a tier with `--project <name>`, e.g. `vitest run --project unit`.
 * Combine projects: `vitest run --project unit --project property`.
 * Shard within a project: `vitest run --project unit --shard=1/3`.
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    /** Run via `pnpm test:contract` + `vitest.contract.config.ts` — needs lexical nock/redis mocks in contract setup */
    /** Chaos runs via `pnpm test:chaos` + `vitest.chaos.config.ts` — requires local Toxiproxy (same as CI chaos job). */
    exclude: ['src/tests/contract/**', 'src/tests/chaos/**', 'src/tests/smoke/**'],
    projects: vitestProjects,
    coverage: {
      provider: 'v8',
      // `json` emits coverage-final.json (istanbul format) so CI shards can be
      // merged into a single report — see tooling/ci/merge-coverage-and-check-thresholds.mjs.
      reporter: ['text', 'lcov', 'json-summary', 'json'],
      reportsDirectory: './coverage',
      include: [
        'src/domains/**/*.service.ts',
        'src/domains/**/*.repository.ts',
        'src/domains/**/*.controller.ts',
        'src/shared/**/*.ts',
      ],
      exclude: [
        'src/tests/**',
        'src/scripts/**',
        'src/domains/**/__tests__/**',
        '**/*.d.ts',
      ],
      // Single source of truth — also consumed by the CI coverage-gate job via
      // tooling/ci/merge-coverage-and-check-thresholds.mjs.
      thresholds: coverageThresholds,
    },
  },
});
