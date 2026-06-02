/**
 * Postgres / driver error helpers (postgres.js uses standard `code` for SQLSTATE).
 */

const POSTGRES_UNIQUE_VIOLATION = '23505';
const POSTGRES_FOREIGN_KEY_VIOLATION = '23503';
const MAX_CAUSE_DEPTH = 5;

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
