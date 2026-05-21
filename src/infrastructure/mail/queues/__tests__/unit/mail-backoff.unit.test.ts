import { describe, it, expect } from 'vitest';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { mailBackoffStrategy } from '@/infrastructure/mail/queues/mail-backoff.util.js';

describe('mailBackoffStrategy', () => {
  it('should use circuit retryAfterMs when Resend circuit is open', () => {
    const error = new CircuitBreakerOpenError('resend', 45_000, 'open');
    expect(mailBackoffStrategy(3, 'custom', error)).toBe(45_000);
  });

  it('should use exponential backoff for transport failures', () => {
    expect(mailBackoffStrategy(1, 'custom', new Error('resend.down'))).toBe(5_000);
    expect(mailBackoffStrategy(2, 'custom', new Error('resend.down'))).toBe(10_000);
  });
});
