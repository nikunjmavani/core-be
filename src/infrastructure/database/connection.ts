import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { THIRTY_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import { env } from '@/shared/config/env.config.js';

function parseSslMode(databaseUrl: string): string | null {
  const match = databaseUrl.match(/[?&]sslmode=([^&]+)/i);
  if (!match?.[1]) return null;
  const raw = match[1];
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export function isNeonPoolerConnection(databaseUrl: string): boolean {
  return /-pooler\./i.test(databaseUrl) || /[?&]pgbouncer=true/i.test(databaseUrl);
}

export function buildPostgresOptions(databaseUrl: string) {
  const sslMode = parseSslMode(databaseUrl);
  const strictVerification =
    sslMode === 'verify-ca' || sslMode === 'verify-full' || env.DB_SSL_REJECT_UNAUTHORIZED === true;

  const sslEnabled =
    sslMode === 'disable' ? false : sslMode !== null || env.NODE_ENV === 'production';

  const ssl = sslEnabled ? { rejectUnauthorized: strictVerification } : false;

  /**
   * When DB_RLS_SCOPED_CONTEXTS is enabled (production hardening item 2), the per-request
   * `SET LOCAL statement_timeout` middleware is bypassed, so the connection-level value
   * must be tight enough to cap runaway HTTP queries (default 5s). When the flag is off,
   * the per-connection cap stays at `DB_STATEMENT_TIMEOUT_MS` (30s default) and per-request
   * `SET LOCAL` provides the tighter per-HTTP-request budget.
   */
  const connectionStatementTimeoutMs = env.DB_RLS_SCOPED_CONTEXTS
    ? env.DB_HTTP_STATEMENT_TIMEOUT_MS > 0
      ? env.DB_HTTP_STATEMENT_TIMEOUT_MS
      : (env.DB_STATEMENT_TIMEOUT_MS ?? THIRTY_SECONDS_MS)
    : (env.DB_STATEMENT_TIMEOUT_MS ?? THIRTY_SECONDS_MS);
  const idleInTransactionTimeoutMs = env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS ?? THIRTY_SECONDS_MS;

  const connectionParameters: Record<string, string> = {
    statement_timeout: String(connectionStatementTimeoutMs),
    idle_in_transaction_session_timeout: String(idleInTransactionTimeoutMs),
  };

  return {
    max: env.DB_MAX ?? 10,
    idle_timeout: env.DB_IDLE_TIMEOUT ?? 30,
    connect_timeout: env.DB_CONNECT_TIMEOUT ?? 10,
    max_lifetime: env.DB_MAX_LIFETIME ?? 1800,
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

export const database = drizzle(sql);

export async function closeDatabase(): Promise<void> {
  const timeout = env.SHUTDOWN_TIMEOUT_MS ?? THIRTY_SECONDS_MS;
  await sql.end({ timeout });
}
