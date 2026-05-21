import type { TestProjectConfiguration } from 'vitest/config';

/**
 * Named Vitest projects — run a tier with `vitest run --project <name>`.
 *
 * Project includes are mutually exclusive so files don't run twice when
 * multiple projects execute together (`pnpm test`, `pnpm test:coverage`).
 *
 * Parallelism rules:
 *   - Pure-unit projects (`unit`, `property`, `global`, `security`, `performance`)
 *     enable file parallelism — handlers and validators are fully mocked.
 *   - DB-bound projects (`unit-db`, `e2e`, `integration`) keep `fileParallelism: false`
 *     because tests share a Postgres database and call `cleanupDatabase()`.
 *
 * Run a slice in parallel (CI matrix shards): `vitest run --project unit --shard=1/3`.
 */
export const vitestProjects = [
  /* ─────────────────────────────  Parallel tiers  ───────────────────────────── */

  /**
   * Pure unit tests — DB and Redis are mocked via `vi.mock()`. Safe to run files
   * concurrently. Includes `__tests__/unit/`, leaf event-handler suites, and any
   * `*.unit.test.ts` outside the DB-bound `*.db.unit.test.ts` suffix.
   */
  {
    extends: true,
    test: {
      name: 'unit',
      include: [
        'src/**/__tests__/unit/**/*.test.ts',
        'src/**/events/__tests__/*.test.ts',
        'src/tests/unit/**/*.test.ts',
      ],
      exclude: ['**/*.db.unit.test.ts', '**/*.property.unit.test.ts'],
      pool: 'forks',
    },
  },

  /** fast-check property tests — pure, parallelizable. */
  {
    extends: true,
    test: {
      name: 'property',
      include: ['src/**/*.property.unit.test.ts'],
      pool: 'forks',
    },
  },

  /** Global regression suite — policy scans, parallelizable. */
  {
    extends: true,
    test: {
      name: 'global',
      include: ['src/tests/global/**/*.global.test.ts'],
    },
  },

  /* ────────────────────────────  Sequential tiers  ──────────────────────────── */

  /**
   * DB-bound unit tests (repository / replay / atomic-consume specs).
   * Use a real Postgres database via `cleanupDatabase()` — must run files serially.
   */
  {
    extends: true,
    test: {
      name: 'unit-db',
      include: ['src/**/*.db.unit.test.ts'],
      pool: 'forks',
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
    },
  },

  /**
   * Bundled domain e2e + dedicated `*.e2e.test.ts` suites + worker tests.
   * All hit the live test app and database; files share `cleanupDatabase()`
   * and must run sequentially.
   */
  {
    extends: true,
    test: {
      name: 'e2e',
      include: [
        'src/domains/**/__tests__/*.test.ts',
        'src/domains/**/__tests__/e2e/**/*.test.ts',
        'src/**/*.e2e.test.ts',
        'src/**/__tests__/*.worker.test.ts',
      ],
      exclude: [
        'src/**/__tests__/unit/**',
        'src/**/__tests__/integration/**',
        'src/**/__tests__/factories/**',
        'src/**/events/__tests__/**',
      ],
      pool: 'forks',
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
    },
  },

  /**
   * Integration tests — `src/tests/integration/**` and per-domain
   * `__tests__/integration/**`. Postgres-backed; sequential.
   */
  {
    extends: true,
    test: {
      name: 'integration',
      include: [
        'src/tests/integration/**/*.test.ts',
        'src/**/__tests__/integration/**/*.test.ts',
      ],
      pool: 'forks',
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
    },
  },

  /**
   * Security tests — almost all use `cleanupDatabase()` or a live app.
   * Sequential to avoid DB cleanup races.
   */
  {
    extends: true,
    test: {
      name: 'security',
      include: ['src/tests/security/**/*.security.test.ts'],
      pool: 'forks',
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
    },
  },

  /** Performance tests — live app + DB; sequential. */
  {
    extends: true,
    test: {
      name: 'performance',
      include: ['src/tests/performance/**/*.performance.test.ts'],
      pool: 'forks',
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
    },
  },

  /* ─────────────────────────  Specialized (own configs)  ─────────────────────── */

  /** Smoke tests — long timeouts, retries; run via `pnpm test:smoke`. */
  {
    extends: true,
    test: {
      name: 'smoke',
      include: ['src/tests/smoke/**/*.smoke.test.ts'],
      pool: 'forks',
      fileParallelism: false,
      retry: 2,
      testTimeout: 30_000,
    },
  },

  /** Toxiproxy chaos suite — own setup, runs via `vitest.chaos.config.ts`. */
  {
    extends: true,
    test: {
      name: 'chaos',
      globalSetup: ['./src/tests/chaos/global-setup.ts'],
      setupFiles: ['./src/tests/chaos/bootstrap-env.ts', './src/tests/chaos/setup.ts'],
      include: ['src/tests/chaos/**/*.chaos.test.ts'],
      exclude: ['src/tests/contract/**'],
      pool: 'forks',
      fileParallelism: false,
      testTimeout: 120_000,
      hookTimeout: 30_000,
    },
  },

  /** Outbound-HTTP contract tests — runs via `vitest.contract.config.ts`. */
  {
    extends: true,
    test: {
      name: 'contract',
      setupFiles: ['./src/tests/setup.ts', './src/tests/contract/contract-vitest-setup.ts'],
      include: ['src/**/*.contract.test.ts'],
      /** Preload nock in fork workers so `http`/`https` are patched before Stripe loads (see nock ESM docs). */
      execArgv: ['--import=nock'],
    },
  },
] satisfies TestProjectConfiguration[];
