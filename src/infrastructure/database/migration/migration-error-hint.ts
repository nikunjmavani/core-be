/**
 * Maps a migration connection/auth failure to a short, actionable, secret-free hint.
 *
 * @remarks
 * Kept in its own side-effect-free module (unlike `migrate.ts`, which connects at import) so it is
 * unit-testable. `migrate.ts` prints the returned hint alongside the raw error, so an operator sees
 * WHY the connection failed — wrong password, unreachable host, missing database — instead of a bare
 * Postgres/driver code like `28P01`. Never includes the connection string or password.
 */

/** Extracts a `code` string off an unknown error/cause chain, if present. */
function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const withCode = error as { code?: unknown; cause?: unknown };
  if (typeof withCode.code === 'string') return withCode.code;
  return withCode.cause ? extractErrorCode(withCode.cause) : undefined;
}

/**
 * Returns an actionable hint for a known connection failure code, or `null` when the failure is not a
 * recognized connection/auth problem (so the caller only surfaces a hint when it genuinely helps).
 */
export function describeMigrationConnectionError(error: unknown): string | null {
  switch (extractErrorCode(error)) {
    case '28P01':
      return 'password authentication failed (28P01): the password in DATABASE_MIGRATION_URL is wrong. Check for a leftover placeholder (e.g. <new-password>), use the freshly-rotated password, and URL-encode special characters (@ : / ? # % → %40 %3A %2F %3F %23 %25).';
    case '28000':
      return 'authorization failed (28000): the role in DATABASE_MIGRATION_URL is not permitted to connect.';
    case '3D000':
      return 'database does not exist (3D000): the database name in DATABASE_MIGRATION_URL is wrong.';
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ETIMEDOUT':
    case 'CONNECT_TIMEOUT':
      return 'cannot reach the database host: verify DATABASE_MIGRATION_URL points at a DIRECT (non-pooler), publicly reachable endpoint — not a *.railway.internal host and not IP-restricted against the runner.';
    default:
      return null;
  }
}
