import baseConfig from './vitest.config.js';

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      'src/tests/unit/**/*.test.ts',
      'src/domains/**/__tests__/unit/**/*.test.ts',
      'src/domains/**/events/__tests__/**/*.test.ts',
      'src/infrastructure/**/__tests__/**/*.test.ts',
    ],
  },
};
