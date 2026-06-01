/**
 * Must stay free of `@/` path alias — env must be deterministic before Vitest resolves application modules.
 * Loads `.env.${NODE_ENV}` (defaulting to `.env.development`) from project root via the shared
 * loader, same as the API and worker entrypoints.
 */
import '../../shared/config/load-env-files.js';

process.env.NODE_ENV ||= 'test';
process.env.VITEST_CHAOS_SUITE = 'true';
/**
 * In-memory rate limiting only: `@fastify/rate-limit` otherwise shares `redisConnection` and can
 * stall requests while other scenarios administratively disable the Redis Toxiproxy listener.
 */
process.env.RUN_REDIS_TESTS = '0';
process.env.RUN_DB_TESTS ||= '1';

process.env.PORT ??= '3000';
process.env.HTTP_BIND_HOST = '127.0.0.1';
process.env.LOG_LEVEL ??= 'warn';
/** Deprecated optional no-op; RS256 keys come from load-env-files / test setup. */
process.env.JWT_SECRET ||= 'test-jwt-secret-min-32-chars-xxxxxxxx';
process.env.ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.FRONTEND_URL ??= 'http://localhost:3000';

process.env.RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';
process.env.ENABLE_QUEUE_DASHBOARD ??= 'true';
process.env.ENABLE_MCP_SERVER ??= 'true';
process.env.BLOCK_DISPOSABLE_EMAIL ??= 'false';

/**
 * Mirrors `src/tests/setup.ts` placeholders so outbound providers stay deterministic under Vitest chaos.
 */
process.env.STRIPE_SECRET_KEY ??= 'sk_test_contract_fixture_key_for_nock_stubs';
process.env.STRIPE_WEBHOOK_SECRET ??=
  'whsec_test_contract_fixture_fallback_when_local_secret_below_32_xx';
process.env.RESEND_API_KEY ??= 're_test_contract_fixture_for_chaos_testing_queue_only';
process.env.EMAIL_FROM_ADDRESS ??= 'noreply@example.com';
process.env.S3_BUCKET ??= 'contract-test-bucket';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_ACCESS_KEY_ID ??= 'AKIAIOSFODNN7EXAMPLE';
process.env.S3_SECRET_ACCESS_KEY ??= 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

const chaosHostedOnGithubActionsContinuousIntegration = process.env.CI === 'true';

/**
 * Always point at Toxiproxy listener ports for this Vitest profile. A developer `.env` often
 * sets direct `localhost:5432` / `6379` URLs; `||=` would skip the override and chaos traffic
 * would bypass proxies, so toxins and administrative proxy disables would not affect the app.
 */
process.env.DATABASE_URL = chaosHostedOnGithubActionsContinuousIntegration
  ? 'postgresql://postgres:postgres@127.0.0.1:25432/core'
  : 'postgresql://core:core@127.0.0.1:25432/core';

process.env.REDIS_URL = 'redis://127.0.0.1:26379';
