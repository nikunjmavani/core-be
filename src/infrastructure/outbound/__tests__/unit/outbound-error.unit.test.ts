import { describe, it, expect } from 'vitest';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import {
  classifyOutboundError,
  ExternalServiceError,
  isOutboundRetryable,
} from '@/infrastructure/outbound/outbound-error.js';

describe('outbound-error', () => {
  it('classifies CircuitBreakerOpenError as circuit_open with retryAfterMs', () => {
    const error = classifyOutboundError(
      new CircuitBreakerOpenError('stripe', 15_000, 'open'),
      'stripe',
    );
    expect(error).toBeInstanceOf(ExternalServiceError);
    expect(error.category).toBe('circuit_open');
    expect(error.retryAfterMs).toBe(15_000);
  });

  it('classifies TimeoutError as timeout', () => {
    const timeoutError = new Error('The operation timed out');
    timeoutError.name = 'TimeoutError';
    const error = classifyOutboundError(timeoutError, 'resend');
    expect(error.category).toBe('timeout');
  });

  it('isOutboundRetryable returns true for circuit_open ExternalServiceError', () => {
    const error = new ExternalServiceError({
      integration: 's3',
      category: 'circuit_open',
      retryAfterMs: 1_000,
    });
    expect(isOutboundRetryable(error)).toBe(true);
  });

  it('isOutboundRetryable returns false for http_4xx ExternalServiceError', () => {
    const error = new ExternalServiceError({
      integration: 'oauth-google',
      category: 'http_4xx',
      status: 401,
    });
    expect(isOutboundRetryable(error)).toBe(false);
  });
});
