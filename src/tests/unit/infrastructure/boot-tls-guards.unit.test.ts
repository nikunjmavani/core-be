/**
 * The two boot-time TLS guards had no test of their own.
 *
 * `assertDatabaseTlsVerification` and `assertRedisTlsVerification` are what stop the app booting with
 * unverified or plaintext transport to Postgres and Redis — the connections that carry session,
 * tenant, and idempotency data. A guard that silently passes is worse than no guard, because it
 * manufactures confidence, so each case below pairs a "throws" with a "does not throw": neither can
 * be satisfied by a guard that has stopped discriminating.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutableEnv } = vi.hoisted(() => ({
  mutableEnv: {} as Record<string, unknown>,
}));

vi.mock('@/shared/config/env.config.js', () => ({ env: mutableEnv }));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { assertDatabaseTlsVerification } = await import(
  '@/infrastructure/database/safety/assert-database-tls-safety.js'
);
const { assertRedisTlsVerification } = await import(
  '@/infrastructure/cache/assert-redis-tls-safety.js'
);

const VERIFIED_DATABASE_URL = 'postgres://user:pass@db.example.com:5432/app?sslmode=verify-full';
const UNVERIFIED_DATABASE_URL = 'postgres://user:pass@db.example.com:5432/app?sslmode=require';

function setEnv(values: Record<string, unknown>): void {
  for (const key of Object.keys(mutableEnv)) delete mutableEnv[key];
  Object.assign(mutableEnv, values);
}

beforeEach(() => {
  setEnv({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('assertDatabaseTlsVerification', () => {
  it('throws when TLS is enforced and the connection does not verify the server certificate', () => {
    setEnv({
      DATABASE_URL: UNVERIFIED_DATABASE_URL,
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      DATABASE_TLS_ENFORCED: true,
    });

    expect(() => assertDatabaseTlsVerification()).toThrow(/database\.tls_safety\.unverified/);
  });

  it('names the offending sslmode in the error so the fix is obvious at boot', () => {
    setEnv({
      DATABASE_URL: UNVERIFIED_DATABASE_URL,
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      DATABASE_TLS_ENFORCED: true,
    });

    // `sslmode=require` encrypts but does not validate the chain — the exact Neon default that
    // makes this guard necessary. A message that omitted it would send an operator hunting.
    expect(() => assertDatabaseTlsVerification()).toThrow(/sslmode=require/);
  });

  it('does not throw when sslmode=verify-full, even with TLS enforced', () => {
    setEnv({
      DATABASE_URL: VERIFIED_DATABASE_URL,
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      DATABASE_TLS_ENFORCED: true,
    });

    expect(() => assertDatabaseTlsVerification()).not.toThrow();
  });

  it('accepts DATABASE_SSL_REJECT_UNAUTHORIZED=true as the alternative route to strict verification', () => {
    setEnv({
      DATABASE_URL: UNVERIFIED_DATABASE_URL,
      DATABASE_SSL_REJECT_UNAUTHORIZED: true,
      DATABASE_TLS_ENFORCED: true,
    });

    expect(() => assertDatabaseTlsVerification()).not.toThrow();
  });

  it('does not throw on an unverified connection when TLS is not enforced (local / CI)', () => {
    setEnv({
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/app',
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      DATABASE_TLS_ENFORCED: false,
    });

    expect(() => assertDatabaseTlsVerification()).not.toThrow();
  });

  it('decides from the explicit DATABASE_TLS_ENFORCED flag alone, not from NODE_ENV', () => {
    // The repo forbids runtime NODE_ENV branching; the safety layer is not exempt. Production with
    // the flag off must behave exactly like development with the flag off.
    setEnv({
      NODE_ENV: 'production',
      DATABASE_URL: UNVERIFIED_DATABASE_URL,
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      DATABASE_TLS_ENFORCED: false,
    });

    expect(() => assertDatabaseTlsVerification()).not.toThrow();
  });
});

describe('assertRedisTlsVerification', () => {
  it('throws when TLS is enforced and Redis is reached over plaintext on a public host', () => {
    setEnv({
      REDIS_URL: 'redis://cache.example.com:6379',
      REDIS_TLS_ENFORCED: true,
    });

    expect(() => assertRedisTlsVerification()).toThrow(/redis\.tls_safety\.unencrypted/);
  });

  it('does not throw for rediss:// (TLS) on the same public host', () => {
    setEnv({
      REDIS_URL: 'rediss://cache.example.com:6379',
      REDIS_TLS_ENFORCED: true,
    });

    expect(() => assertRedisTlsVerification()).not.toThrow();
  });

  it('permits plaintext redis:// on a trusted private network', () => {
    // Railway private networking and Kubernetes cluster DNS are isolated, so plaintext stays
    // allowed there. Without this case the guard could be "fixed" by refusing every redis:// URL,
    // which would break every hosted deployment on private networking.
    setEnv({
      REDIS_URL: 'redis://redis.railway.internal:6379',
      REDIS_TLS_ENFORCED: true,
    });

    expect(() => assertRedisTlsVerification()).not.toThrow();
  });

  it('permits plaintext redis:// on an RFC 1918 address', () => {
    setEnv({
      REDIS_URL: 'redis://10.0.0.5:6379',
      REDIS_TLS_ENFORCED: true,
    });

    expect(() => assertRedisTlsVerification()).not.toThrow();
  });

  it('checks the separate BullMQ endpoint, not just REDIS_URL', () => {
    // Two clients, two URLs. A guard that validated only the main connection would leave every
    // queued job payload travelling in plaintext.
    setEnv({
      REDIS_URL: 'rediss://cache.example.com:6379',
      REDIS_BULLMQ_URL: 'redis://queue.example.com:6379',
      REDIS_TLS_ENFORCED: true,
    });

    expect(() => assertRedisTlsVerification()).toThrow(/REDIS_BULLMQ_URL/);
  });

  it('does not throw on plaintext public Redis when TLS is not enforced (local / CI)', () => {
    setEnv({
      REDIS_URL: 'redis://cache.example.com:6379',
      REDIS_TLS_ENFORCED: false,
    });

    expect(() => assertRedisTlsVerification()).not.toThrow();
  });
});
