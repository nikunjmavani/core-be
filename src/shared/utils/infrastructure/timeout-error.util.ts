/** Returns true when `error` carries Fastify's request-timeout error code (`FST_ERR_REQ_TIMEOUT`). */
export function isFastifyRequestTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'FST_ERR_REQ_TIMEOUT'
  );
}

/**
 * Returns true when `error` represents a PostgreSQL statement timeout / query
 * cancellation, by SQLSTATE `57014` or the standard cancellation message.
 */
export function isPostgresStatementTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === '57014') {
    return true;
  }

  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = '';
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes('statement timeout') ||
    normalized.includes('canceling statement') ||
    normalized.includes('query_canceled')
  );
}
