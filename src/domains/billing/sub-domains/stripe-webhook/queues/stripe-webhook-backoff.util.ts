import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { TEN_SECONDS_MS } from '@/shared/constants/ttl.constants.js';

/** BullMQ custom backoff for stripe-webhook jobs (Stripe circuit-open vs default exponential). */
export function stripeWebhookBackoffStrategy(
  attemptsMade: number,
  _type: string | undefined,
  error: Error | undefined,
): number {
  if (error instanceof CircuitBreakerOpenError) {
    return error.retryAfterMs;
  }
  const attemptIndex = Math.max(attemptsMade, 1);
  return TEN_SECONDS_MS * 2 ** (attemptIndex - 1);
}
