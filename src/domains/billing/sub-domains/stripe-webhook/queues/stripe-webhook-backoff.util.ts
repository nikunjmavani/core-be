import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';

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
  return 10_000 * 2 ** (attemptIndex - 1);
}
