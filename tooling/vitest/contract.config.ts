import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Contract tests require lexical mocks + nock bootstrap in setup (see
 * `contract-vitest-setup.ts`) and are run via `pnpm test:contract` only —
 * excluded from the default Vitest graph.
 */
export default defineConfig({
  root: projectRoot,
  test: {
    globals: true,
    globalSetup: [resolve(projectRoot, 'src/tests/global-setup.ts')],
    setupFiles: [
      resolve(projectRoot, 'src/tests/setup.ts'),
      resolve(projectRoot, 'src/tests/contract/contract-vitest-setup.ts'),
    ],
    include: ['src/tests/contract/**/*.test.ts'],
    /**
     * `live/**` is the opt-in real-API slice (`pnpm test:contract:live`, its own config). It must
     * never load here: this tier preloads nock and runs with `CONTRACT_TESTS_ENABLED=true`, which
     * overwrites every third-party credential with a placeholder.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'src/tests/contract/live/**'],
    /** Preload nock in fork workers so `http`/`https` are patched before Stripe loads (see nock ESM docs). */
    execArgv: ['--import=nock'],
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
