const DEFAULT_JITTER_RATIO = 0.2;

/**
 * Knobs for {@link retryWithBackoff}. `maxDelayMs` caps exponential growth (defaults to
 * `baseDelayMs * 8`); `jitterRatio` adds proportional randomness so synchronized clients
 * do not retry in lockstep; `shouldRetry` decides per-error whether to keep going
 * (default retries everything).
 */
export interface RetryWithBackoffOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown) => boolean;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Retries an async operation with exponential backoff and jitter.
 * The full retry loop should run inside a single circuit-breaker `execute()` call.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryWithBackoffOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs = baseDelayMs * 8,
    jitterRatio = DEFAULT_JITTER_RATIO,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      const exponentialDelayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitterMs = Math.floor(Math.random() * exponentialDelayMs * jitterRatio);
      await sleep(exponentialDelayMs + jitterMs);
    }
  }
  throw lastError;
}

/**
 * Heuristic for "this error is probably worth retrying": matches `AbortError`/`TimeoutError`
 * names plus common substring fingerprints for fetch failures, socket resets, DNS
 * timeouts, and generic timeouts. Used as the default `shouldRetry` predicate by
 * outbound integrations.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const message = error.message.toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket') ||
    message.includes('timeout')
  );
}
