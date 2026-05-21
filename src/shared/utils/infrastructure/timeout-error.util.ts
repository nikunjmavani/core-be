export function isFastifyRequestTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'FST_ERR_REQ_TIMEOUT'
  );
}

export function isPostgresStatementTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === '57014') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('statement timeout') ||
    normalized.includes('canceling statement') ||
    normalized.includes('query_canceled')
  );
}
