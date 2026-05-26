import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '@/infrastructure/resilience/circuit-breaker.js';
import { outboundCall } from '@/infrastructure/outbound/outbound-call.js';
import { ExternalServiceError } from '@/infrastructure/outbound/outbound-error.js';

describe('outboundCall', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws ExternalServiceError with timeout category when operation exceeds timeout', async () => {
    const promise = outboundCall({
      name: 'oauth-google',
      timeoutMs: 50,
      circuit: null,
      operation: async (signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
        return 'never';
      },
    });

    await vi.advanceTimersByTimeAsync(60);

    await expect(promise).rejects.toMatchObject({
      integration: 'oauth-google',
      category: expect.stringMatching(/^(timeout|aborted)$/),
    });
    await expect(promise).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('runs retry inside circuit execute', async () => {
    vi.useRealTimers();
    let attempts = 0;
    const circuit = new CircuitBreaker({
      name: 'retry-inside-circuit',
      failureThreshold: 10,
    });

    const result = await outboundCall({
      name: 'resend',
      circuit,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1,
        shouldRetry: () => true,
      },
      operation: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('fetch failed');
          throw error;
        }
        return 'ok';
      },
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    vi.useFakeTimers();
  });

  it('maps CircuitBreakerOpenError to ExternalServiceError circuit_open', async () => {
    const circuit = new CircuitBreaker({
      name: 'open-fast',
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
    });

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');

    await expect(
      outboundCall({
        name: 'stripe',
        circuit,
        operation: async () => 'ok',
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });
});
