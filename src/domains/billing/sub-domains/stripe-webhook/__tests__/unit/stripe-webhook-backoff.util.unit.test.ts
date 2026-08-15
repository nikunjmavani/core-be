import { describe, expect, it } from 'vitest';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { TEN_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import { stripeWebhookBackoffStrategy } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook-backoff.util.js';

/**
 * The `stripe-webhook` queue declares `attempts: 5` with `backoff: { type: 'custom' }`, so this
 * function *is* the retry curve for every failed webhook job. A wrong curve means either
 * hammering Stripe (too flat) or pushing events past the 5-attempt DLQ threshold before the
 * outage clears (too steep) — neither is visible from any other test.
 */
describe('stripe-webhook-backoff.util', () => {
  it('starts the exponential curve at 10s on the first attempt', () => {
    expect(stripeWebhookBackoffStrategy(1, 'custom', new Error('boom'))).toBe(TEN_SECONDS_MS);
  });

  it('doubles on each subsequent attempt', () => {
    const error = new Error('boom');
    expect(stripeWebhookBackoffStrategy(2, 'custom', error)).toBe(TEN_SECONDS_MS * 2);
    expect(stripeWebhookBackoffStrategy(3, 'custom', error)).toBe(TEN_SECONDS_MS * 4);
    expect(stripeWebhookBackoffStrategy(4, 'custom', error)).toBe(TEN_SECONDS_MS * 8);
  });

  it("stays monotonically increasing across the queue's five configured attempts", () => {
    const error = new Error('boom');
    const delays = [1, 2, 3, 4, 5].map((attempt) =>
      stripeWebhookBackoffStrategy(attempt, 'custom', error),
    );

    for (let index = 1; index < delays.length; index++) {
      expect(delays[index]).toBeGreaterThan(delays[index - 1] as number);
    }
    // The curve is bounded by the queue's `attempts: 5`, not by an internal clamp: the final
    // retry waits 160s, so a job is dead-lettered ~5 minutes into an outage rather than hours.
    expect(delays.at(-1)).toBe(TEN_SECONDS_MS * 16);
  });

  it('never returns a non-positive delay for attempt 0 or a negative attempt count', () => {
    // `Math.max(attemptsMade, 1)` guards the exponent. Without it, attempt 0 would yield a
    // half-window (5s) and negative input would produce fractional millisecond delays that
    // BullMQ treats as an immediate re-run — a hot retry loop against Stripe.
    const error = new Error('boom');
    expect(stripeWebhookBackoffStrategy(0, 'custom', error)).toBe(TEN_SECONDS_MS);
    expect(stripeWebhookBackoffStrategy(-3, 'custom', error)).toBe(TEN_SECONDS_MS);
  });

  it("defers to the circuit breaker's retryAfterMs instead of the exponential curve", () => {
    // When the Stripe circuit is open, the breaker already knows when it will next probe.
    // Retrying before then is guaranteed to fail and burns one of the five attempts.
    const retryAfterMs = 42_000;
    const circuitOpen = new CircuitBreakerOpenError('stripe', retryAfterMs, 'circuit open');

    expect(stripeWebhookBackoffStrategy(1, 'custom', circuitOpen)).toBe(retryAfterMs);
    expect(stripeWebhookBackoffStrategy(4, 'custom', circuitOpen)).toBe(retryAfterMs);
  });

  it('falls back to the exponential curve when no error is supplied', () => {
    expect(stripeWebhookBackoffStrategy(2, undefined, undefined)).toBe(TEN_SECONDS_MS * 2);
  });
});
