import baseConfig from './vitest.config.js';

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    globalSetup: ['./src/tests/chaos/global-setup.ts'],
    setupFiles: ['./src/tests/chaos/bootstrap-env.ts', './src/tests/chaos/setup.ts'],
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
