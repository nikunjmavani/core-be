import { describe, expect, it } from 'vitest';
import { envSchema, envSchemaKeys } from '@/shared/config/env-schema.js';

const DATABASE_URL_FIXTURE = 'postgres://localhost:5432/core';
const REDIS_URL_FIXTURE = 'redis://localhost:6379';

const productionRedisTopology = {
  REDIS_URL: 'redis://shared.example.railway.internal:6379',
};

const commonRequiredBase = {
  DATABASE_URL: DATABASE_URL_FIXTURE,
  REDIS_URL: REDIS_URL_FIXTURE,
  JWT_SECRET: 'a'.repeat(32),
  JWT_PRIVATE_KEY: 'private',
  JWT_PUBLIC_KEY: 'public',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  METRICS_SCRAPE_TOKEN: 'b'.repeat(32),
  // High-entropy 32-byte hex key — production rejects low-entropy placeholders (e.g. all-zeros).
  SECRETS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  AUDIT_RETENTION_DAYS: '30',
  AUTH_SESSION_RETENTION_DAYS: '30',
};

const productionRequiredBase = {
  ...commonRequiredBase,
  NODE_ENV: 'production',
  // Production requires absolute https origins (no plaintext http / wildcard).
  ALLOWED_ORIGINS: 'https://app.example.com',
  CAPTCHA_PROVIDER: 'turnstile',
  CAPTCHA_SECRET: 'turnstile-secret',
  ...productionRedisTopology,
};

describe('env-schema', () => {
  it('exports schema keys for tooling sync', () => {
    expect(envSchemaKeys.length).toBeGreaterThan(0);
    expect(envSchemaKeys).toContain('DATABASE_URL');
    expect(envSchemaKeys).toContain('JWT_SECRET');
  });

  it('applies DATABASE_HTTP_STATEMENT_TIMEOUT_MS and pool alert defaults', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      AUDIT_RETENTION_DAYS: '30',
      AUTH_SESSION_RETENTION_DAYS: '30',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_HTTP_STATEMENT_TIMEOUT_MS).toBe(5_000);
      expect(parsed.data.DATABASE_POOL_ACTIVE_WARN_RATIO).toBe(0.8);
      expect(parsed.data.DATABASE_POOL_ALERT_POLL_INTERVAL_MS).toBe(5_000);
    }
  });

  it('coerces PORT and applies defaults for optional fields', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      PORT: '4000',
      NODE_ENV: 'test',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PORT).toBe(4000);
      expect(parsed.data.AUTH_SESSION_MAX_AGE_DAYS).toBe(7);
    }
  });

  it('requires EMAIL_FROM_ADDRESS when RESEND_API_KEY is set', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      RESEND_API_KEY: 're_test_key',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes('EMAIL_FROM_ADDRESS'))).toBe(
        true,
      );
    }
  });

  it('accepts RESEND_API_KEY together with EMAIL_FROM_ADDRESS', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      RESEND_API_KEY: 're_test_key',
      EMAIL_FROM_ADDRESS: 'noreply@example.com',
    });
    expect(parsed.success).toBe(true);
  });

  it('allows EMAIL_FROM_ADDRESS to be absent when RESEND_API_KEY is unset', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects ALLOWED_ORIGINS containing a wildcard in any environment', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      ALLOWED_ORIGINS: 'https://app.example.com,*',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects plaintext http ALLOWED_ORIGINS in production', () => {
    const parsed = envSchema.safeParse({
      ...productionRequiredBase,
      ALLOWED_ORIGINS: 'http://app.example.com',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts https ALLOWED_ORIGINS in production', () => {
    const parsed = envSchema.safeParse({
      ...productionRequiredBase,
      ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
    });
    expect(parsed.success).toBe(true);
  });

  it('allows http localhost ALLOWED_ORIGINS outside production', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    expect(parsed.success).toBe(true);
  });

  it('transforms TRUST_PROXY "1" to a hop count', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      AUDIT_RETENTION_DAYS: '30',
      AUTH_SESSION_RETENTION_DAYS: '30',
      TRUST_PROXY: '1',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.TRUST_PROXY).toBe(1);
    }
  });

  it('rejects bare TRUST_PROXY=true', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      TRUST_PROXY: 'true',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.TRUST_PROXY).toBeDefined();
    }
  });

  it('transforms TRUST_PROXY disabled values to false', () => {
    const disabled = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      TRUST_PROXY: '0',
    });

    expect(disabled.success && disabled.data.TRUST_PROXY).toBe(false);
  });

  it('coerces optional boolean-like env strings', () => {
    const disposableAllowed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'test',
      BLOCK_DISPOSABLE_EMAIL: 'false',
      SCHEDULER_ENABLED: '0',
    });

    expect(disposableAllowed.success).toBe(true);
    if (disposableAllowed.success) {
      expect(disposableAllowed.data.BLOCK_DISPOSABLE_EMAIL).toBe(false);
      expect(disposableAllowed.data.SCHEDULER_ENABLED).toBe(false);
    }
  });

  it('parses without JWT_SECRET when RS256 keys are set', () => {
    const environmentInput = { ...process.env };
    delete environmentInput.JWT_SECRET;
    const parsed = envSchema.safeParse({
      ...environmentInput,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      NODE_ENV: 'test',
      JWT_PRIVATE_KEY: 'test-private-key',
      JWT_PUBLIC_KEY: 'test-public-key',
      AUDIT_RETENTION_DAYS: '30',
      AUTH_SESSION_RETENTION_DAYS: '30',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.JWT_SECRET).toBeUndefined();
  });

  it('accepts optional RS256 JWT key pair alongside JWT_SECRET', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      JWT_PRIVATE_KEY: 'test-private-key',
      JWT_PUBLIC_KEY: 'test-public-key',
    });

    expect(parsed.success).toBe(true);
  });

  it('transforms ENABLE_RESPONSE_ENCRYPTION string values', () => {
    const enabled = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      ENABLE_RESPONSE_ENCRYPTION: 'true',
      RESPONSE_ENCRYPTION_KEY: 'a'.repeat(64),
    });
    const disabled = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      ENABLE_RESPONSE_ENCRYPTION: '0',
    });

    expect(enabled.success && enabled.data.ENABLE_RESPONSE_ENCRYPTION).toBe(true);
    expect(disabled.success && disabled.data.ENABLE_RESPONSE_ENCRYPTION).toBe(false);
  });

  it('rejects idempotency cardinality when critical threshold is below warn threshold', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD: '100',
      IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD: '10',
    });

    expect(parsed.success).toBe(false);
  });

  it('requires RS256 keys in production', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'production',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects JWT_SECRET shorter than minimum length', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'too-short',
      NODE_ENV: 'test',
    });

    expect(parsed.success).toBe(false);
  });

  it('transforms feature-flag env strings to booleans', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      AUDIT_RETENTION_DAYS: '30',
      AUTH_SESSION_RETENTION_DAYS: '30',
      ENABLE_MCP_SERVER: 'true',
      ENABLE_API_REFERENCE: 'true',
      ENABLE_QUEUE_DASHBOARD: '1',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ENABLE_MCP_SERVER).toBe(true);
      expect(parsed.data.ENABLE_API_REFERENCE).toBe(true);
      expect(parsed.data.ENABLE_QUEUE_DASHBOARD).toBe(true);
      expect(parsed.data.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
    }
  });

  it('accepts production when RS256 keys are provided', () => {
    const parsed = envSchema.safeParse(productionRequiredBase);

    expect(parsed.success).toBe(true);
  });

  it('allows a shared or dedicated BullMQ Redis endpoint in production', () => {
    const sharedWithoutBullMqUrl = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_BULLMQ_URL: undefined,
    });
    expect(sharedWithoutBullMqUrl.success).toBe(true);

    const sharedWithSameBullMqUrl = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_URL: 'redis://shared.example.railway.internal:6379',
      REDIS_BULLMQ_URL: 'redis://shared.example.railway.internal:6379',
    });
    expect(sharedWithSameBullMqUrl.success).toBe(true);

    // A dedicated BullMQ endpoint is supported (recommended production isolation).
    const separateBullMqHost = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_BULLMQ_URL: 'redis://bullmq.example.railway.internal:6379',
    });
    expect(separateBullMqHost.success).toBe(true);

    // A non-parseable override is rejected.
    const invalidBullMqUrl = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_BULLMQ_URL: 'not a url',
    });
    expect(invalidBullMqUrl.success).toBe(false);
  });

  it('allows single Redis host when NODE_ENV is local', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'local',
    });

    expect(parsed.success).toBe(true);
  });

  it('requires SECRETS_ENCRYPTION_KEY in production', () => {
    const { SECRETS_ENCRYPTION_KEY: secretsEncryptionKey, ...productionWithoutSecretsKey } =
      productionRequiredBase;
    void secretsEncryptionKey;

    const missingKey = envSchema.safeParse(productionWithoutSecretsKey);
    expect(missingKey.success).toBe(false);
    if (!missingKey.success) {
      expect(
        missingKey.error.issues.some((issue) => issue.path[0] === 'SECRETS_ENCRYPTION_KEY'),
      ).toBe(true);
    }

    const withKey = envSchema.safeParse(productionRequiredBase);
    expect(withKey.success).toBe(true);
  });

  it('rejects a low-entropy / placeholder SECRETS_ENCRYPTION_KEY in production', () => {
    const allZeros = envSchema.safeParse({
      ...productionRequiredBase,
      SECRETS_ENCRYPTION_KEY: '0'.repeat(64),
    });
    expect(allZeros.success).toBe(false);
    if (!allZeros.success) {
      expect(
        allZeros.error.issues.some((issue) => issue.path[0] === 'SECRETS_ENCRYPTION_KEY'),
      ).toBe(true);
    }

    // Single-character placeholder (e.g. the test default `'a'.repeat(64)`) is also rejected.
    const singleChar = envSchema.safeParse({
      ...productionRequiredBase,
      SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
    });
    expect(singleChar.success).toBe(false);
  });

  it('allows a low-entropy SECRETS_ENCRYPTION_KEY outside production (ephemeral test/CI keys)', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'test',
      SECRETS_ENCRYPTION_KEY: '0'.repeat(64),
    });
    expect(parsed.success).toBe(true);
  });

  it('requires METRICS_SCRAPE_TOKEN whenever METRICS_ENABLED is true', () => {
    const productionWithMetrics = {
      ...productionRequiredBase,
      METRICS_ENABLED: 'true',
      METRICS_SCRAPE_TOKEN: undefined,
    };

    const missingToken = envSchema.safeParse(productionWithMetrics);
    expect(missingToken.success).toBe(false);
    if (!missingToken.success) {
      expect(
        missingToken.error.issues.some((issue) => issue.path[0] === 'METRICS_SCRAPE_TOKEN'),
      ).toBe(true);
    }

    const withToken = envSchema.safeParse({
      ...productionWithMetrics,
      METRICS_SCRAPE_TOKEN: 'b'.repeat(32),
    });
    expect(withToken.success).toBe(true);
  });

  it('accepts NODE_ENV staging for secure cookies and staging deploys', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'staging',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.NODE_ENV).toBe('staging');
    }
  });

  it('accepts a public FRONTEND_URL across all NODE_ENV values (magic-link inline-token leak removed)', () => {
    /**
     * Previously, non-production runtimes were forced to use a localhost
     * FRONTEND_URL because the magic-link service inlined the raw token in
     * API responses. That leak has been eliminated, so deployed non-production
     * environments may now use real public URLs identical to production.
     */
    const parsedDevelopment = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      FRONTEND_URL: 'https://staging.example.com',
    });
    expect(parsedDevelopment.success).toBe(true);

    const parsedLocalhost = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:3000',
    });
    expect(parsedLocalhost.success).toBe(true);
  });

  it('rejects production boot when CAPTCHA is not turnstile', () => {
    const {
      CAPTCHA_PROVIDER: _provider,
      CAPTCHA_SECRET: _secret,
      ...withoutCaptcha
    } = productionRequiredBase;
    void _provider;
    void _secret;

    const parsed = envSchema.safeParse(withoutCaptcha);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === 'CAPTCHA_PROVIDER')).toBe(true);
    }
  });

  it('rejects production boot when CAPTCHA_PROVIDER=disabled', () => {
    const parsed = envSchema.safeParse({
      ...productionRequiredBase,
      CAPTCHA_PROVIDER: 'disabled',
      CAPTCHA_SECRET: undefined,
    });
    expect(parsed.success).toBe(false);
  });

  it('allows production boot with configured turnstile CAPTCHA', () => {
    const parsed = envSchema.safeParse(productionRequiredBase);
    expect(parsed.success).toBe(true);
  });

  it('does not require Turnstile CAPTCHA outside production', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      CAPTCHA_PROVIDER: 'disabled',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects production boot when COOKIE_SECURE is disabled', () => {
    const parsed = envSchema.safeParse({
      ...productionRequiredBase,
      COOKIE_SECURE: 'false',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === 'COOKIE_SECURE')).toBe(true);
    }
  });

  it('allows COOKIE_SECURE=false outside production (local plaintext loops)', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'development',
      COOKIE_SECURE: 'false',
    });
    expect(parsed.success).toBe(true);
  });

  it('defaults COOKIE_SECURE to true and accepts it in production', () => {
    const parsed = envSchema.safeParse(productionRequiredBase);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.COOKIE_SECURE).toBe(true);
    }
  });

  it('rejects production boot when legacy RLS pinning is enabled without break-glass ack', () => {
    const parsed = envSchema.safeParse({
      ...productionRequiredBase,
      DATABASE_RLS_SCOPED_CONTEXTS: 'false',
      DATABASE_RLS_LEGACY_PINNING_ACK: 'false',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.path[0] === 'DATABASE_RLS_SCOPED_CONTEXTS'),
      ).toBe(true);
    }
  });

  it('allows production boot with legacy RLS pinning when break-glass ack is set', () => {
    const parsed = envSchema.safeParse({
      ...productionRequiredBase,
      DATABASE_RLS_SCOPED_CONTEXTS: 'false',
      DATABASE_RLS_LEGACY_PINNING_ACK: 'true',
    });
    expect(parsed.success).toBe(true);
  });

  it('defaults DATABASE_RLS_SCOPED_CONTEXTS to true', () => {
    const parsed = envSchema.safeParse({
      ...commonRequiredBase,
      NODE_ENV: 'test',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_RLS_SCOPED_CONTEXTS).toBe(true);
    }
  });

  it('rejects FRONTEND_URL that is not a valid http(s) URL', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'development',
      FRONTEND_URL: 'not-a-url',
      AUDIT_RETENTION_DAYS: '30',
      AUTH_SESSION_RETENTION_DAYS: '30',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.FRONTEND_URL).toBeDefined();
    }
  });
});
