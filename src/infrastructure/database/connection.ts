import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { THIRTY_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import { env } from '@/shared/config/env.config.js';
import {
  isNeonPoolerConnection,
  isStrictDatabaseTlsVerification,
  parseSslMode,
} from '@/infrastructure/database/utils/connection-url.util.js';

import {
  DEFAULT_DATABASE_POOL_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_SECONDS,
  DEFAULT_DATABASE_POOL_MAX,
  DEFAULT_DATABASE_POOL_MAX_LIFETIME_SECONDS,
} from '@/infrastructure/database/pool/pool.constants.js';

export { isNeonPoolerConnection };
export { DEFAULT_DATABASE_POOL_MAX };

/**
 * Builds the postgres.js client options from `DATABASE_URL` + env: SSL mode parsed from
 * the URL (and tightened by `DATABASE_SSL_REJECT_UNAUTHORIZED`), per-connection
 * `statement_timeout` / `idle_in_transaction_session_timeout`, pool sizing, and a
 * Neon-pooler-aware `prepare: false` toggle.
 */
export function buildPostgresOptions(databaseUrl: string) {
  const sslMode = parseSslMode(databaseUrl);
  const strictVerification = isStrictDatabaseTlsVerification({
    databaseUrl,
    rejectUnauthorizedOverride: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  });

  const sslEnabled = sslMode === 'disable' ? false : sslMode !== null || env.DATABASE_SSL_ENABLED;

  const ssl = sslEnabled ? { rejectUnauthorized: strictVerification } : false;

  /**
   * HTTP handlers use scoped RLS contexts (short transactions per unit-of-work), so the
   * connection-level `statement_timeout` must cap runaway queries on autocommit paths
   * (default 5s via `DATABASE_HTTP_STATEMENT_TIMEOUT_MS`).
   */
  const connectionStatementTimeoutMs =
    env.DATABASE_HTTP_STATEMENT_TIMEOUT_MS > 0
      ? env.DATABASE_HTTP_STATEMENT_TIMEOUT_MS
      : (env.DATABASE_STATEMENT_TIMEOUT_MS ?? THIRTY_SECONDS_MS);
  const idleInTransactionTimeoutMs =
    env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS ?? THIRTY_SECONDS_MS;

  const connectionParameters: Record<string, string> = {
    statement_timeout: String(connectionStatementTimeoutMs),
    idle_in_transaction_session_timeout: String(idleInTransactionTimeoutMs),
  };

  return {
    max: env.DATABASE_POOL_MAX,
    idle_timeout:
      env.DATABASE_POOL_IDLE_TIMEOUT_SECONDS ?? DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_SECONDS,
    connect_timeout:
      env.DATABASE_POOL_CONNECT_TIMEOUT_SECONDS ?? DEFAULT_DATABASE_POOL_CONNECT_TIMEOUT_SECONDS,
    max_lifetime:
      env.DATABASE_POOL_MAX_LIFETIME_SECONDS ?? DEFAULT_DATABASE_POOL_MAX_LIFETIME_SECONDS,
    ssl,
    connection: connectionParameters,
    ...(isNeonPoolerConnection(databaseUrl) ? { prepare: false as const } : {}),
  };
}

/**
 * postgres.js pools TCP connections per process. Managed Postgres (Neon, Railway) may close
 * idle connections around ~5 minutes — if you see sporadic ECONNRESET, validate provider
 * keepalive / proxy settings.
 */
export const sql = postgres(env.DATABASE_URL, buildPostgresOptions(env.DATABASE_URL));

/**
 * Process-wide Drizzle handle bound to the {@link sql} postgres.js pool — the
 * default database accessor for repositories and ad-hoc queries when no
 * request/worker context has pinned a transaction-scoped handle in ALS.
 */
export const database = drizzle(sql);

/**
 * Drains the postgres.js pool and waits up to `SHUTDOWN_TIMEOUT_MS` (30s default)
 * for in-flight queries before terminating. Called from the shutdown middleware.
 */
export async function closeDatabase(): Promise<void> {
  const timeout = env.SHUTDOWN_TIMEOUT_MS ?? THIRTY_SECONDS_MS;
  await sql.end({ timeout });
}
