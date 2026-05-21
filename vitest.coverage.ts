import type { CoverageV8Options } from 'vitest/node';

export const vitestCoverageConfig = {
  provider: 'v8',
  reporter: ['text', 'lcov', 'json-summary'],
  reportsDirectory: './coverage',
  /** Write HTML/LCOV even when thresholds fail so `coverage/` exists locally and in CI artifacts */
  reportOnFailure: true,
  include: [
    'src/domains/**/*.service.ts',
    'src/domains/**/*.repository.ts',
    'src/domains/**/*.controller.ts',
    'src/shared/**/*.ts',
  ],
  exclude: ['src/tests/**', 'src/scripts/**', 'src/domains/**/__tests__/**', '**/*.d.ts'],
  thresholds: {
    perFile: true,
    lines: 90,
    functions: 90,
    statements: 90,
    branches: 90,
    'src/domains/auth/**': {
      lines: 95,
      functions: 95,
      statements: 95,
      branches: 95,
    },
    'src/domains/billing/**': {
      lines: 95,
      functions: 95,
      statements: 95,
      branches: 95,
    },
    'src/domains/tenancy/**': {
      lines: 95,
      functions: 95,
      statements: 95,
      branches: 95,
    },
    'src/shared/middlewares/auth.middleware.ts': {
      lines: 95,
      functions: 95,
      statements: 95,
      branches: 95,
    },
    'src/shared/middlewares/tenant.middleware.ts': {
      lines: 95,
      functions: 95,
      statements: 95,
      branches: 95,
    },
  },
} satisfies CoverageV8Options;
