import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Live outbound contract slice — `pnpm test:contract:live`.
 *
 * The offline tier (`contract.config.ts`) replays committed fixtures with
 * `nock.disableNetConnect()`, so it validates our request shape and response mapping but can
 * never detect a provider changing its API. This config runs the same contracts against the
 * real sandbox endpoints.
 *
 * Differences from the offline config, each load-bearing:
 * - **No `--import=nock`, no nock setup.** Real sockets are the point.
 * - **No `CONTRACT_TESTS_ENABLED`.** That flag makes `src/tests/setup.ts` overwrite every
 *   third-party credential with a placeholder.
 * - **No `globalSetup`.** This slice needs no database.
 * - **Serial, generous timeouts.** Real third-party latency, and the specs clean up after
 *   themselves (delete the Stripe customer, delete the S3 object).
 *
 * Excluded from `pnpm test` and from CI — every provider skips unless `CONTRACT_LIVE=true` and
 * that provider's credentials are present. See `.env.contract-live.example`.
 */
export default defineConfig({
  root: projectRoot,
  test: {
    globals: true,
    setupFiles: [resolve(projectRoot, 'src/tests/contract/live/live-setup.ts')],
    include: ['src/tests/contract/live/**/*.live.contract.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
    server: {
      deps: {
        external: ['stripe', 'resend', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
      '@tooling': resolve(projectRoot, 'tooling'),
    },
  },
});
