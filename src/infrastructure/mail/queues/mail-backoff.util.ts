import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { FIVE_SECONDS_MS } from '@/shared/constants/ttl.constants.js';

/** BullMQ custom backoff for the mail queue (Resend circuit-open vs transport retries). */
export function mailBackoffStrategy(
  attemptsMade: number,
  _type: string | undefined,
  error: Error | undefined,
): number {
  if (error instanceof CircuitBreakerOpenError) {
    return error.retryAfterMs;
  }
  const attemptIndex = Math.max(attemptsMade, 1);
  return FIVE_SECONDS_MS * 2 ** (attemptIndex - 1);
}
