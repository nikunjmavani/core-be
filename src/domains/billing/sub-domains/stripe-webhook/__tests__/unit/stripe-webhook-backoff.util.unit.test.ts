import { describe, expect, it } from 'vitest';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { stripeWebhookBackoffStrategy } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook-backoff.util.js';
import { TEN_SECONDS_MS } from '@/shared/constants/ttl.constants.js';

/**
 * BullMQ calls this on every failed Stripe-webhook job to decide the retry delay. Two behaviours
 * matter and neither was pinned: the circuit-breaker override (when Stripe's breaker is open, wait
 * exactly as long as the breaker says rather than the generic curve) and the exponential curve
 * itself. A regression here either hammers a provider that has already told us to back off, or
 * stretches retries so far that webhook processing silently falls behind.
 */
describe('stripe-webhook-backoff.util', () => {
  describe('circuit-breaker override', () => {
    it('defers to the breaker retryAfterMs instead of the exponential curve', () => {
      const error = new CircuitBreakerOpenError('stripe', 4321, 'circuit open');

      expect(stripeWebhookBackoffStrategy(1, undefined, error)).toBe(4321);
    });

    it('uses the breaker delay regardless of how many attempts have been made', () => {
      const error = new CircuitBreakerOpenError('stripe', 4321, 'circuit open');

      for (const attemptsMade of [0, 1, 5, 20]) {
        expect(stripeWebhookBackoffStrategy(attemptsMade, undefined, error)).toBe(4321);
      }
    });

    it('honours a zero retryAfterMs from the breaker', () => {
      const error = new CircuitBreakerOpenError('stripe', 0, 'circuit open');

      // Not the falsy-fallback to the curve — the breaker is authoritative.
      expect(stripeWebhookBackoffStrategy(3, undefined, error)).toBe(0);
    });
  });

  describe('exponential curve for ordinary failures', () => {
    it.each([
      [1, TEN_SECONDS_MS],
      [2, TEN_SECONDS_MS * 2],
      [3, TEN_SECONDS_MS * 4],
      [4, TEN_SECONDS_MS * 8],
      [5, TEN_SECONDS_MS * 16],
    ])('attempt %i waits %i ms', (attemptsMade, expected) => {
      expect(stripeWebhookBackoffStrategy(attemptsMade, undefined, new Error('boom'))).toBe(
        expected,
      );
    });

    it('clamps attemptsMade of 0 to the first-attempt delay', () => {
      // Math.max(attemptsMade, 1) — a 0 must not produce TEN_SECONDS_MS / 2.
      expect(stripeWebhookBackoffStrategy(0, undefined, new Error('boom'))).toBe(TEN_SECONDS_MS);
    });

    it('clamps a negative attemptsMade to the first-attempt delay', () => {
      expect(stripeWebhookBackoffStrategy(-3, undefined, new Error('boom'))).toBe(TEN_SECONDS_MS);
    });

    it('is strictly increasing across consecutive attempts', () => {
      const delays = [1, 2, 3, 4, 5, 6].map((attemptsMade) =>
        stripeWebhookBackoffStrategy(attemptsMade, undefined, new Error('boom')),
      );

      for (let index = 1; index < delays.length; index += 1) {
        expect(delays[index]).toBeGreaterThan(delays[index - 1] as number);
      }
    });

    it('applies the curve when the error is undefined', () => {
      expect(stripeWebhookBackoffStrategy(2, undefined, undefined)).toBe(TEN_SECONDS_MS * 2);
    });

    it('ignores the job type argument', () => {
      const withType = stripeWebhookBackoffStrategy(3, 'exponential', new Error('boom'));
      const withoutType = stripeWebhookBackoffStrategy(3, undefined, new Error('boom'));

      expect(withType).toBe(withoutType);
    });

    it('treats a non-breaker error with a retryAfterMs property as an ordinary failure', () => {
      // Only a real CircuitBreakerOpenError may override the curve — duck typing must not.
      const lookalike = Object.assign(new Error('nope'), { retryAfterMs: 99 });

      expect(stripeWebhookBackoffStrategy(2, undefined, lookalike)).toBe(TEN_SECONDS_MS * 2);
    });
  });
});
