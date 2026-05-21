import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Contract tests require lexical mocks + nock bootstrap in setup (see `contract-vitest-setup.ts`)
 * and are run via `pnpm test:contract` only — excluded from the default Vitest graph.
 */
export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/tests/global-setup.ts'],
    setupFiles: ['./src/tests/setup.ts', './src/tests/contract/contract-vitest-setup.ts'],
    include: ['src/tests/contract/**/*.test.ts'],
    /** Preload nock in fork workers so `http`/`https` are patched before Stripe loads (see nock ESM docs). */
    execArgv: ['--import=nock'],
    server: {
      deps: {
        external: [
          'stripe',
          'resend',
          '@aws-sdk/client-s3',
          '@aws-sdk/s3-request-presigner',
        ],
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
