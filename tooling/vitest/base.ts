import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Shared Vitest settings inherited by all projects in the root `vitest.config.ts`
 * (`extends: true`). Tier-specific include/exclude and overrides live in
 * `tooling/vitest/projects.ts`.
 *
 * Paths are anchored to the project root via `__dirname` so the file can live
 * outside the repo root without breaking setup/global-setup discovery.
 */
export default defineConfig({
  test: {
    globals: true,
    globalSetup: [resolve(projectRoot, 'src/tests/global-setup.ts')],
    setupFiles: [resolve(projectRoot, 'src/tests/setup.ts')],
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
      '@': resolve(projectRoot, 'src'),
      '@tooling': resolve(projectRoot, 'tooling'),
    },
  },
});
