import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '@/infrastructure/resilience/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('should open after failure threshold and fail fast (in-memory fallback)', async () => {
    const circuit = new CircuitBreaker({
      name: 'test-circuit-in-memory',
      failureThreshold: 2,
      resetTimeoutMs: 60_000,
    });

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');
    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');
    await expect(circuit.execute(async () => Promise.resolve('ok'))).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });

  it('should attach retryAfterMs on CircuitBreakerOpenError', async () => {
    const circuit = new CircuitBreaker({
      name: 'open-error-retry-after',
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
    });

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');

    await expect(circuit.execute(async () => Promise.resolve('ok'))).rejects.toMatchObject({
      circuitName: 'open-error-retry-after',
      retryAfterMs: expect.any(Number),
    });
  });

  it('should pass through when circuit is closed', async () => {
    const circuit = new CircuitBreaker({
      name: 'closed-circuit-in-memory',
      failureThreshold: 5,
    });

    const result = await circuit.execute(async () => 'success');
    expect(result).toBe('success');
  });

  it('mutates Redis state with a single circuitMutate command per failure', async () => {
    const circuitKey = `circuit:lua-unit-${randomUUID()}`;
    let mutateInvocations = 0;

    const redis = {
      defineCommand: vi.fn(),
      get: vi.fn(async () =>
        JSON.stringify({
          state: 'CLOSED',
          failures: 0,
          lastFailureTime: 0,
          halfOpenAttempts: 0,
        }),
      ),
      circuitMutate: vi.fn(async () => {
        mutateInvocations += 1;
        return JSON.stringify({
          state: 'OPEN',
          failures: 5,
          lastFailureTime: Date.now(),
          halfOpenAttempts: 0,
        });
      }),
    } as unknown as Redis;

    const circuit = new CircuitBreaker({
      name: circuitKey.replace('circuit:', ''),
      redis,
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');

    expect(mutateInvocations).toBeGreaterThanOrEqual(1);
    expect(redis.defineCommand).toHaveBeenCalledWith(
      'circuitMutate',
      expect.objectContaining({ numberOfKeys: 1 }),
    );
  });

  it('falls back to local state when circuitMutate fails', async () => {
    const redis = {
      defineCommand: vi.fn(),
      get: vi.fn(async () => null),
      circuitMutate: vi.fn(async () => {
        throw new Error('redis_unavailable');
      }),
    } as unknown as Redis;

    const circuit = new CircuitBreaker({
      name: `fallback-local-${randomUUID()}`,
      redis,
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
    });

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');
    await expect(circuit.execute(async () => Promise.resolve('ok'))).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });
});
