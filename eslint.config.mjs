import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import security from 'eslint-plugin-security';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      sonarjs,
      security,
    },
    rules: {
      // ── TypeScript ────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',

      // ── Code quality ──────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-param-reassign': 'error',
      'no-return-await': 'warn',
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],

      // ── Code smells (sonarjs) ─────────────────────────────────
      'sonarjs/cognitive-complexity': ['warn', 25],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/prefer-single-boolean-return': 'warn',

      // ── Security ──────────────────────────────────────────────
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-object-injection': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-unsafe-regex': 'error',
    },
  },
  // Test files: long describe blocks, repeated URLs/paths, dynamic test helpers
  {
    files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts', 'src/tests/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'sonarjs/no-duplicate-string': ['warn', { threshold: 15 }],
      'sonarjs/cognitive-complexity': ['warn', 30],
      complexity: ['warn', 25],
      'security/detect-object-injection': 'off',
    },
  },
  // MCP server: resource + tool registration setup
  {
    files: ['src/infrastructure/mcp/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  // Route aggregators and workers: many registrations / setup lines
  {
    files: ['src/**/*.routes.ts', 'src/**/workers/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'sonarjs/no-duplicate-string': ['warn', { threshold: 6 }],
    },
  },
  // Stripe webhook HMAC must run in stripe-webhook-ingress.plugin, not controllers
  {
    files: ['src/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/infrastructure/payment/stripe.client.js',
              importNames: ['constructStripeWebhookEvent'],
              message:
                'Stripe webhook signature verification belongs in stripe-webhook-ingress.plugin.ts. Controllers must read request.stripeWebhookEvent only.',
            },
          ],
        },
      ],
    },
  },
  // Production hardening item 2 (DATABASE_RLS_SCOPED_CONTEXTS): never call Stripe / S3 / Resend
  // SDK methods inside a withOrganizationDatabaseContext / withOrganizationContext callback —
  // such work holds a pool checkout across network I/O and re-creates the failure mode the
  // RLS unpin was meant to fix. Phase: short tx -> external call -> short tx.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**', 'src/tests/**', 'src/scripts/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/^(withOrganizationContext|withOrganizationDatabaseContext)$/] CallExpression[callee.property.name="execute"][callee.object.name=/^(stripeCircuit|s3Circuit|resendCircuit)$/]',
          message:
            'External SDK calls (stripeCircuit/s3Circuit/resendCircuit.execute) must not run inside a withOrganizationDatabaseContext/withOrganizationContext callback. Phase external I/O outside the database context.',
        },
        {
          selector:
            'CallExpression[callee.name=/^(withOrganizationContext|withOrganizationDatabaseContext)$/] AwaitExpression > CallExpression[callee.object.name=/^(stripeClient|getStorageClient)$/]',
          message:
            'External SDK calls (Stripe / storage client) must not run inside a withOrganizationDatabaseContext/withOrganizationContext callback. Phase external I/O outside the database context.',
        },
      ],
    },
  },
  // Runtime Stripe / Resend / S3 SDK imports only in infrastructure wrappers (see external-sdk-coverage.global.test.ts)
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/infrastructure/payment/stripe.client.ts',
      'src/infrastructure/mail/mail.service.ts',
      'src/infrastructure/storage/s3-adapter.ts',
      'src/infrastructure/storage/storage.service.ts',
      'src/**/__tests__/**',
      'src/tests/**',
      'src/scripts/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'stripe',
              message:
                'Import Stripe only from @/infrastructure/payment/stripe.client.js (circuit-wrapped). Type-only imports are allowed.',
              allowTypeImports: true,
            },
            {
              name: 'resend',
              message:
                'Import Resend only from @/infrastructure/mail/mail.service.js (circuit-wrapped).',
            },
            {
              name: '@aws-sdk/client-s3',
              message:
                'Import @aws-sdk/client-s3 only from src/infrastructure/storage/ (circuit-wrapped).',
            },
          ],
        },
      ],
    },
  },
  // Workers/processors must use explicit database handles from context wrappers, not getRequestDatabase()
  {
    files: [
      'src/**/workers/**/*.ts',
      'src/**/*.worker.ts',
      'src/**/*.processor.ts',
      'src/infrastructure/database/batch-delete.util.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/infrastructure/database/request-database.context.js',
              message:
                'Workers and processors must not import request-database.context. Use WorkerDatabaseHandle from context wrappers and createWorker*Repository(databaseHandle) factories.',
            },
            {
              name: '@/infrastructure/database/connection.js',
              importNames: ['database'],
              message:
                'Workers and processors must not import the global database pool. Use context wrappers and an explicit databaseHandle from runTenantScopedWorkerJob / runGlobalRetentionWorkerJob / runUserScopedWorkerJob.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="getRequestDatabase"]',
          message:
            'Workers and processors must not call getRequestDatabase(). Pass an explicit databaseHandle from a worker context wrapper.',
        },
        {
          selector:
            'CallExpression[callee.name=/^(withOrganizationContext|withOrganizationDatabaseContext|withGlobalRetentionCleanupDatabaseContext|withUserDatabaseContext|withSessionRetentionCleanupDatabaseContext)$/] CallExpression[callee.property.name="execute"][callee.object.name=/^(stripeCircuit|s3Circuit|resendCircuit)$/]',
          message:
            'External SDK calls (stripeCircuit/s3Circuit/resendCircuit.execute) must not run inside a database-context callback. Exit the context, perform the network call, then re-enter a short context for status updates (production hardening item 2).',
        },
      ],
    },
  },
  // CLI/build scripts: console output, dynamic spec parsing, large mapping logic
  {
    files: ['src/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      'max-lines-per-function': 'off',
      complexity: ['warn', 95],
      'sonarjs/cognitive-complexity': ['warn', 95],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 15 }],
      'security/detect-object-injection': 'off',
    },
  },
  // Repo-root setup:infra wizard (outside src/; not in tsc include)
  {
    files: ['tooling/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      sonarjs,
      security,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'max-lines-per-function': 'off',
      complexity: ['warn', 95],
      'sonarjs/cognitive-complexity': ['warn', 95],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 15 }],
      'security/detect-object-injection': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'migrations/'],
  },
];
