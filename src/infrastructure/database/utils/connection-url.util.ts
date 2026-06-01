/**
 * Pure helpers for reasoning about a Postgres connection string (SSL mode, pooler
 * detection, strict TLS verification). Kept free of any module-level side effects —
 * importing this file must NOT open a connection pool or trigger env validation — so
 * the migration runner (`migration/migrate.ts`) and boot-time TLS assertion can reuse
 * the same logic without instantiating the process-wide `postgres()` pool in
 * `connection.ts`.
 */

/**
 * Extracts and normalizes the `sslmode` query parameter from a Postgres URL.
 *
 * @remarks
 * - **Algorithm:** matches `?sslmode=` / `&sslmode=` case-insensitively, then
 *   percent-decodes and lowercases the value.
 * - **Failure modes:** returns `null` when the URL carries no `sslmode` parameter.
 * - **Side effects:** none — pure string parsing.
 */
export function parseSslMode(databaseUrl: string): string | null {
  const match = /[?&]sslmode=([^&]+)/i.exec(databaseUrl);
  if (!match?.[1]) return null;
  const raw = match[1];
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * Heuristic for Neon's PgBouncer-fronted connection string — when true we disable
 * postgres.js prepared statements because PgBouncer in transaction-pooling mode
 * does not preserve server-side prepared statement state across checkouts. The same
 * signal also flags a connection that must NOT be used for migrations, because a
 * session-level `pg_advisory_lock` is not pinned to a single backend through a
 * transaction-mode pooler.
 *
 * @remarks
 * - **Algorithm:** matches a `-pooler.` host segment or an explicit `pgbouncer=true`
 *   query parameter.
 * - **Side effects:** none — pure string parsing.
 */
export function isNeonPoolerConnection(databaseUrl: string): boolean {
  return /-pooler\./i.test(databaseUrl) || /[?&]pgbouncer=true/i.test(databaseUrl);
}

/** Inputs for {@link isStrictDatabaseTlsVerification}. */
export interface StrictDatabaseTlsVerificationInput {
  /** The Postgres connection string whose `sslmode` is inspected. */
  databaseUrl: string;
  /** Value of `DATABASE_SSL_REJECT_UNAUTHORIZED` (forces strict verification when `true`). */
  rejectUnauthorizedOverride?: boolean | undefined;
}

/**
 * True when the Postgres client should verify the server's TLS certificate chain.
 *
 * @remarks
 * - **Algorithm:** strict when `sslmode` is `verify-ca` / `verify-full` (the libpq
 *   modes that validate the certificate) OR when `DATABASE_SSL_REJECT_UNAUTHORIZED`
 *   is explicitly `true`. `sslmode=require` encrypts but does NOT verify, so it is
 *   intentionally not treated as strict.
 * - **Side effects:** none — pure computation.
 */
export function isStrictDatabaseTlsVerification({
  databaseUrl,
  rejectUnauthorizedOverride,
}: StrictDatabaseTlsVerificationInput): boolean {
  const sslMode = parseSslMode(databaseUrl);
  return (
    sslMode === 'verify-ca' || sslMode === 'verify-full' || rejectUnauthorizedOverride === true
  );
}
