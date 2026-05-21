import '@/shared/config/load-env-files.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { resetJwtCachesForTests } from '@/shared/utils/security/jwt.util.js';

process.env.NODE_ENV ??= 'test';

/** Tests use HS256 + JWT_SECRET; clear production RSA keys from `.env` so sign/verify stay aligned. */
if (process.env.NODE_ENV === 'test') {
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  resetJwtCachesForTests();
}

// Suppress BullMQ Redis eviction policy warning in tests (local/CI Redis often uses volatile-lru)
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : String(args[0]);
  if (message.includes('Eviction policy is') && message.includes('noeviction')) return;
  originalWarn.apply(console, args);
};
process.env.LOG_LEVEL ??= 'info';
process.env.PORT ??= '3000';
process.env.HOST = '127.0.0.1';
// Prefer local Docker Postgres for tests (see docker-compose.yml) even when .env points elsewhere
process.env.USE_LOCAL_TEST_DATABASE ??= 'true';
process.env.DATABASE_URL ??= 'postgresql://core:core@localhost:5432/core';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RUN_REDIS_TESTS ??= '1';
process.env.JWT_SECRET ??= 'test-jwt-secret-min-32-chars-xxxxxxxx';
process.env.SECRETS_ENCRYPTION_KEY ??= 'a'.repeat(64);
/** Local `.env` may set a short Stripe webhook signing secret — HMAC helpers require plausible length under test */
if (
  process.env.NODE_ENV === 'test' &&
  process.env.STRIPE_WEBHOOK_SECRET !== undefined &&
  process.env.STRIPE_WEBHOOK_SECRET.length > 0 &&
  process.env.STRIPE_WEBHOOK_SECRET.length < 32
) {
  process.env.STRIPE_WEBHOOK_SECRET =
    'whsec_test_contract_fixture_fallback_when_local_secret_below_32_xx';
}

/**
 * Isolated outbound contract slice (`pnpm test:contract`): force placeholders so `.env`
 * sandbox keys / bucket names / regions never leak into mocks (or vice versa).
 */
if (process.env.CONTRACT_TESTS_ONLY === 'true') {
  process.env.STRIPE_SECRET_KEY = 'sk_test_contract_fixture_key_for_nock_stubs';
  process.env.STRIPE_WEBHOOK_SECRET =
    'whsec_test_contract_fixture_webhook_signing_must_be_minimum_32characters';
  process.env.RESEND_API_KEY = 're_test_contract_fixture_key';
  process.env.S3_BUCKET = 'contract-test-bucket';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
  process.env.S3_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
}

/**
 * Offline contract tests — infra wrappers require env before nock stubs network (non-overriding baseline).
 */
process.env.STRIPE_SECRET_KEY ??= 'sk_test_contract_fixture_key';
process.env.STRIPE_WEBHOOK_SECRET ??=
  'whsec_test_contract_fixture_secret_minimum_length_32_chars_xx';
process.env.RESEND_API_KEY ??= 're_test_contract_fixture_key';
process.env.S3_BUCKET ??= 'contract-test-bucket';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_ACCESS_KEY_ID ??= 'AKIAIOSFODNN7EXAMPLE';
process.env.S3_SECRET_ACCESS_KEY ??= 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

process.env.ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';
process.env.AUDIT_RETENTION_DAYS ??= '90';
process.env.SESSION_RETENTION_DAYS ??= '30';
process.env.ENABLE_QUEUE_DASHBOARD ??= 'true';
process.env.ENABLE_MCP_SERVER ??= 'true';
// Allow disposable emails in tests so flows using yopmail/mailinator etc. can run
if (process.env.NODE_ENV === 'test') {
  process.env.BLOCK_DISPOSABLE_EMAIL = 'false';
}
resetEnvCacheForTests();
