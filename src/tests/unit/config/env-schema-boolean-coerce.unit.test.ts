import { describe, expect, it } from 'vitest';
import { envSchema } from '@/shared/config/env-schema.js';

/**
 * Regression for sec-C1 (High): `z.coerce.boolean()` is `Boolean(String)` — every non-empty
 * string (including `"false"` and `"0"`) coerces to `true`. Operator-facing kill-switches
 * declared with that schema cannot actually be disabled via env, breaking incident response.
 *
 * The repo already ships a correct `booleanString()` helper (true/1 → true, everything else
 * → false). The two fields with the foot-gun schema are:
 *   - `DLQ_AUTO_RETRY_ENABLED` (default true): an operator setting it to "false" to halt a
 *     runaway DLQ retry storm has no effect; the sweeper keeps replaying poison jobs.
 *   - `DATABASE_SSL_REJECT_UNAUTHORIZED` (optional, no default): less impactful (mistake
 *     leaves verification ON), but still surprising and undocumented.
 */
const REQUIRED_BASE = {
  DATABASE_URL: 'postgres://localhost:5432/core',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  JWT_PRIVATE_KEY: 'private',
  JWT_PUBLIC_KEY: 'public',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  METRICS_SCRAPE_TOKEN: 'b'.repeat(32),
  SECRETS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  NODE_ENV: 'test' as const,
  AUDIT_RETENTION_DAYS: '30',
  AUTH_SESSION_RETENTION_DAYS: '30',
};

describe('env-schema boolean coercion (sec-C1)', () => {
  it('parses DLQ_AUTO_RETRY_ENABLED="false" as false (not the z.coerce.boolean foot-gun)', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DLQ_AUTO_RETRY_ENABLED: 'false',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DLQ_AUTO_RETRY_ENABLED).toBe(false);
    }
  });

  it('parses DLQ_AUTO_RETRY_ENABLED="0" as false', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DLQ_AUTO_RETRY_ENABLED: '0',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DLQ_AUTO_RETRY_ENABLED).toBe(false);
    }
  });

  it('parses DLQ_AUTO_RETRY_ENABLED="true" as true (positive case still works)', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DLQ_AUTO_RETRY_ENABLED: 'true',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DLQ_AUTO_RETRY_ENABLED).toBe(true);
    }
  });

  it('parses DLQ_AUTO_RETRY_ENABLED="1" as true', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DLQ_AUTO_RETRY_ENABLED: '1',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DLQ_AUTO_RETRY_ENABLED).toBe(true);
    }
  });

  it('defaults DLQ_AUTO_RETRY_ENABLED to true when unset', () => {
    const parsed = envSchema.safeParse(REQUIRED_BASE);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DLQ_AUTO_RETRY_ENABLED).toBe(true);
    }
  });

  it('parses DATABASE_SSL_REJECT_UNAUTHORIZED="false" as false (not the z.coerce.boolean foot-gun)', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(false);
    }
  });

  it('parses DATABASE_SSL_REJECT_UNAUTHORIZED="0" as false', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DATABASE_SSL_REJECT_UNAUTHORIZED: '0',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(false);
    }
  });

  it('parses DATABASE_SSL_REJECT_UNAUTHORIZED="true" as true (positive case still works)', () => {
    const parsed = envSchema.safeParse({
      ...REQUIRED_BASE,
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
    }
  });

  it('leaves DATABASE_SSL_REJECT_UNAUTHORIZED undefined when unset (no default — caller decides)', () => {
    const parsed = envSchema.safeParse(REQUIRED_BASE);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.DATABASE_SSL_REJECT_UNAUTHORIZED).toBeUndefined();
    }
  });
});
