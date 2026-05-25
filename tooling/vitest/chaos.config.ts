import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from './base.js';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configurationDirectory, '..', '..');

/**
 * Toxiproxy chaos suite — runs via `pnpm test:chaos`. Excluded from the default
 * Vitest graph (see root `vitest.config.ts` exclude list).
 */
export default {
  ...baseConfig,
  root: projectRoot,
  test: {
    ...baseConfig.test,
    globalSetup: [resolve(projectRoot, 'src/tests/chaos/global-setup.ts')],
    setupFiles: [
      resolve(projectRoot, 'src/tests/chaos/bootstrap-env.ts'),
      resolve(projectRoot, 'src/tests/chaos/setup.ts'),
    ],
    include: ['src/tests/chaos/**/*.chaos.test.ts'],
    /** Base vitest config excludes chaos; this profile must run them. */
    exclude: ['src/tests/contract/**'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 30_000,
    coverage: {
      enabled: false,
    },
  },
};
