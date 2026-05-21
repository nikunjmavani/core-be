import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest settings inherited by all projects in vitest.config.ts (`extends: true`).
 * Tier-specific include/exclude and overrides live in tooling/vitest/projects.ts.
 */
export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/tests/global-setup.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    /**
     * Nock patches `node:http` / `node:https`; Vite must not pre-bundle Stripe / Resend /
     * AWS SDK into the test graph or each copy bypasses the patched modules.
     */
    server: {
      deps: {
        external: ['stripe', 'resend', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@tooling/openapi': resolve(__dirname, 'tooling/openapi'),
    },
  },
});
