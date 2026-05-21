import { describe, expect, it } from 'vitest';
import { envSchema, envSchemaKeys } from '@/shared/config/env-schema.js';

const DATABASE_URL_FIXTURE = 'postgres://localhost:5432/core';
const REDIS_URL_FIXTURE = 'redis://localhost:6379';

const productionRedisTopology = {
  REDIS_URL: 'redis://shared.example.upstash.io:6379',
};

const productionRequiredBase = {
  DATABASE_URL: DATABASE_URL_FIXTURE,
  JWT_SECRET: 'a'.repeat(32),
  NODE_ENV: 'production',
  JWT_PRIVATE_KEY: 'private',
  JWT_PUBLIC_KEY: 'public',
  SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
  AUDIT_RETENTION_DAYS: '30',
  SESSION_RETENTION_DAYS: '30',
  ...productionRedisTopology,
};

describe('env-schema', () => {
  it('exports schema keys for tooling sync', () => {
    expect(envSchemaKeys.length).toBeGreaterThan(0);
    expect(envSchemaKeys).toContain('DATABASE_URL');
    expect(envSchemaKeys).toContain('JWT_SECRET');
  });

  it('applies DB_HTTP_STATEMENT_TIMEOUT_MS and pool alert defaults', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DB_HTTP_STATEMENT_TIMEOUT_MS).toBe(5_000);
      expect(parsed.data.DB_POOL_ACTIVE_WARN_RATIO).toBe(0.8);
      expect(parsed.data.DB_POOL_ALERT_POLL_INTERVAL_MS).toBe(5_000);
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
      expect(parsed.data.SESSION_MAX_AGE_DAYS).toBe(7);
    }
  });

  it('transforms TRUST_PROXY "1" to true', () => {
    const parsed = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
      TRUST_PROXY: '1',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.TRUST_PROXY).toBe(true);
    }
  });

  it('transforms TRUST_PROXY string values to boolean', () => {
    const enabled = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      TRUST_PROXY: 'true',
    });
    const disabled = envSchema.safeParse({
      ...process.env,
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      TRUST_PROXY: '0',
    });

    expect(enabled.success && enabled.data.TRUST_PROXY).toBe(true);
    expect(disabled.success && disabled.data.TRUST_PROXY).toBe(false);
  });

  it('coerces optional boolean-like env strings', () => {
    const disposableAllowed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'test',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
      BLOCK_DISPOSABLE_EMAIL: 'false',
      SCHEDULER_ENABLED: '0',
    });

    expect(disposableAllowed.success).toBe(true);
    if (disposableAllowed.success) {
      expect(disposableAllowed.data.BLOCK_DISPOSABLE_EMAIL).toBe(false);
      expect(disposableAllowed.data.SCHEDULER_ENABLED).toBe(false);
    }
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
      SESSION_RETENTION_DAYS: '30',
      ENABLE_MCP_SERVER: 'true',
      ENABLE_API_REFERENCE: 'true',
      ENABLE_QUEUE_DASHBOARD: '1',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ENABLE_MCP_SERVER).toBe(true);
      expect(parsed.data.ENABLE_API_REFERENCE).toBe(true);
      expect(parsed.data.ENABLE_QUEUE_DASHBOARD).toBe(true);
      expect(parsed.data.DB_SSL_REJECT_UNAUTHORIZED).toBe(true);
    }
  });

  it('accepts production when RS256 keys are provided', () => {
    const parsed = envSchema.safeParse(productionRequiredBase);

    expect(parsed.success).toBe(true);
  });

  it('allows one Redis instance in production', () => {
    const sharedWithoutBullMqUrl = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_BULLMQ_URL: undefined,
    });
    expect(sharedWithoutBullMqUrl.success).toBe(true);

    const sharedWithSameBullMqUrl = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_URL: 'redis://shared.example.upstash.io:6379',
      REDIS_BULLMQ_URL: 'redis://shared.example.upstash.io:6379',
    });
    expect(sharedWithSameBullMqUrl.success).toBe(true);

    const separateBullMqHost = envSchema.safeParse({
      ...productionRequiredBase,
      REDIS_BULLMQ_URL: 'redis://bullmq.example.upstash.io:6379',
    });
    expect(separateBullMqHost.success).toBe(false);
  });

  it('allows single Redis host when NODE_ENV is local', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'local',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
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

  it('requires METRICS_BEARER_TOKEN in production when METRICS_ENABLED is true', () => {
    const productionWithMetrics = {
      ...productionRequiredBase,
      METRICS_ENABLED: 'true',
    };

    const missingToken = envSchema.safeParse(productionWithMetrics);
    expect(missingToken.success).toBe(false);
    if (!missingToken.success) {
      expect(
        missingToken.error.issues.some((issue) => issue.path[0] === 'METRICS_BEARER_TOKEN'),
      ).toBe(true);
    }

    const withToken = envSchema.safeParse({
      ...productionWithMetrics,
      METRICS_BEARER_TOKEN: 'b'.repeat(32),
    });
    expect(withToken.success).toBe(true);
  });

  it('accepts NODE_ENV staging for secure cookies and staging deploys', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'staging',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.NODE_ENV).toBe('staging');
    }
  });

  it('rejects non-local FRONTEND_URL when NODE_ENV is not production', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'development',
      FRONTEND_URL: 'https://staging.example.com',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.FRONTEND_URL).toBeDefined();
    }
  });

  it('allows localhost FRONTEND_URL when NODE_ENV is development', () => {
    const parsed = envSchema.safeParse({
      DATABASE_URL: DATABASE_URL_FIXTURE,
      REDIS_URL: REDIS_URL_FIXTURE,
      JWT_SECRET: 'a'.repeat(32),
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:3000',
      AUDIT_RETENTION_DAYS: '30',
      SESSION_RETENTION_DAYS: '30',
    });

    expect(parsed.success).toBe(true);
  });
});
