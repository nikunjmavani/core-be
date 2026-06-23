/**
 * Postgres / driver error helpers (postgres.js uses standard `code` for SQLSTATE).
 */

const POSTGRES_UNIQUE_VIOLATION = '23505';
const POSTGRES_FOREIGN_KEY_VIOLATION = '23503';
const MAX_CAUSE_DEPTH = 5;

/**
 * SQLSTATE class 08 (connection_exception) codes plus Node socket-error codes that indicate the
 * connection dropped underneath an in-flight query rather than the query itself being wrong. Managed
 * Postgres (Neon, Railway) closes idle connections (~5 min) and recycles pooler backends, so a query
 * issued the instant a connection is reaped fails transiently even though a retry on a fresh
 * connection succeeds. Query-logic errors (constraint violations, syntax, permission) are NOT here —
 * they must never be retried.
 */
const TRANSIENT_CONNECTION_ERROR_CODES = new Set<string>([
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '57P01', // admin_shutdown (server closed the connection)
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'CONNECTION_ENDED', // postgres.js: connection ended before the query completed
  'CONNECTION_DESTROYED',
  'CONNECTION_CLOSED',
]);

const DEFAULT_TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 25;

/**
 * Returns true when `error` — or any error in its `cause` chain — carries the
 * given SQLSTATE `code`. Drizzle wraps the driver's `PostgresError` (which holds
 * the SQLSTATE) in `error.cause`, so a top-level-only check misses the code and
 * a concurrent unique-violation loser would surface as a 500 instead of a 409.
 */
function hasPostgresErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Returns true when `error` is a Postgres `unique_violation` (SQLSTATE 23505). */
export function isPostgresUniqueViolation(error: unknown): boolean {
  return hasPostgresErrorCode(error, POSTGRES_UNIQUE_VIOLATION);
}

/** Returns true when `error` is a Postgres `foreign_key_violation` (SQLSTATE 23503). */
export function isPostgresForeignKeyViolation(error: unknown): boolean {
  return hasPostgresErrorCode(error, POSTGRES_FOREIGN_KEY_VIOLATION);
}

/**
 * Returns the violated unique-constraint / index name from a Postgres error (or
 * any error in its `cause` chain), if present.
 */
export function getPostgresConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    const name = (current as { constraint_name?: unknown }).constraint_name;
    if (typeof name === 'string') return name;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Returns true when `error` — or any error in its `cause` chain — is a transient connection drop
 * (SQLSTATE class 08, admin shutdown, or a Node socket reset) rather than a query-logic error.
 *
 * @remarks
 * - **Algorithm:** walks the `cause` chain (Drizzle wraps the driver error) checking each link's
 *   `code` against {@link TRANSIENT_CONNECTION_ERROR_CODES}.
 * - **Notes:** intentionally narrow — only errors that a retry on a fresh connection could plausibly
 *   resolve. Constraint/syntax/permission errors return false so callers never retry a doomed query.
 */
export function isTransientConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_CONNECTION_ERROR_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs an **idempotent, autocommit** read, retrying it a bounded number of times when it fails with a
 * transient connection drop ({@link isTransientConnectionError}).
 *
 * @remarks
 * - **Algorithm:** up to `maxAttempts` calls; between attempts waits a short linear backoff
 *   (`TRANSIENT_RETRY_BASE_DELAY_MS * attempt`) to let postgres.js acquire a fresh connection.
 * - **Failure modes:** a non-transient error (or the final attempt) rethrows unchanged.
 * - **Side effects:** none beyond re-invoking `read`. **Caller contract:** `read` MUST be a read with
 *   no side effects and MUST NOT run inside an open transaction — a mid-transaction connection drop
 *   aborts the whole transaction, so re-issuing only the read would run on an aborted handle. Use
 *   only on standalone autocommit reads (e.g. pre-handler auth lookups).
 */
export async function runReadWithTransientRetry<T>(
  read: () => Promise<T>,
  maxAttempts = DEFAULT_TRANSIENT_RETRY_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (!isTransientConnectionError(error) || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_BASE_DELAY_MS * attempt));
    }
  }
  throw lastError;
}

/**
 * Retries an insert ONLY when the `public_id` index collides. Regenerating a
 * `public_id` cannot resolve a collision on any other unique index (e.g. a slug),
 * so retrying those is futile — and, worse, each retry runs on the already-aborted
 * transaction and surfaces as a `25P02 in_failed_sql_transaction` (a 500). For a
 * non-`public_id` unique violation we rethrow immediately so the caller can map it
 * to a 409 and the transaction rolls back cleanly. The callback must generate a new
 * `public_id` on each attempt (call inside the callback).
 */
export async function runInsertWithPublicIdentifierRetry<T>(
  insert: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await insert();
    } catch (error) {
      lastError = error;
      const isPublicIdCollision =
        isPostgresUniqueViolation(error) &&
        (getPostgresConstraintName(error)?.includes('public_id') ?? false);
      if (!isPublicIdCollision || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}
