/**
 * Postgres / driver error helpers (postgres.js uses standard `code` for SQLSTATE).
 */

const POSTGRES_UNIQUE_VIOLATION = '23505';
const POSTGRES_FOREIGN_KEY_VIOLATION = '23503';

export function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

export function isPostgresForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === POSTGRES_FOREIGN_KEY_VIOLATION
  );
}

/**
 * Retries an insert when `public_id` (or any column) collides on the unique index.
 * The callback must generate a new `public_id` on each attempt (call inside the callback).
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
      if (!isPostgresUniqueViolation(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}
