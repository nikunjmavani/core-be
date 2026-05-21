import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '@/infrastructure/resilience/circuit-breaker.js';

const RESET_TIMEOUT_MS = 10_000;

function createCircuit(overrides: { failureThreshold?: number; halfOpenAttempts?: number } = {}) {
  return new CircuitBreaker({
    name: `state-machine-${randomUUID()}`,
    failureThreshold: overrides.failureThreshold ?? 1,
    halfOpenAttempts: overrides.halfOpenAttempts ?? 1,
    resetTimeoutMs: RESET_TIMEOUT_MS,
  });
}

describe('CircuitBreaker state machine (in-memory fallback)', () => {
  beforeEach(() => {
    /** Fake timers also mock `Date` so `Date.now()` advances deterministically with `vi.advanceTimersByTime`. */
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions open → half-open after reset timeout', async () => {
    const circuit = createCircuit();

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');
    expect(await circuit.getState()).toBe('OPEN');

    /** Still inside the reset window: subsequent calls fail fast. */
    await expect(circuit.execute(async () => 'noop')).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );

    vi.advanceTimersByTime(RESET_TIMEOUT_MS + 1);

    /** A pending probe lets us observe the HALF_OPEN state between transition and resolution. */
    let releaseProbe: () => void = () => undefined;
    const probe = new Promise<string>((resolve) => {
      releaseProbe = () => resolve('probe-ok');
    });

    const probeExecution = circuit.execute(async () => probe);

    /** Allow the state machine microtasks to run so the OPEN→HALF_OPEN transition is recorded. */
    await Promise.resolve();
    await Promise.resolve();
    expect(await circuit.getState()).toBe('HALF_OPEN');

    releaseProbe();
    await expect(probeExecution).resolves.toBe('probe-ok');
  });

  it('transitions half-open → closed after a successful probe', async () => {
    const circuit = createCircuit();

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');
    expect(await circuit.getState()).toBe('OPEN');

    vi.advanceTimersByTime(RESET_TIMEOUT_MS + 1);

    await expect(circuit.execute(async () => 'recovered')).resolves.toBe('recovered');
    expect(await circuit.getState()).toBe('CLOSED');
  });

  it('transitions half-open → open after a failed probe', async () => {
    /** halfOpenAttempts = 1 means the very next failure after entering HALF_OPEN must re-open. */
    const circuit = createCircuit({ failureThreshold: 1, halfOpenAttempts: 1 });

    await expect(
      circuit.execute(async () => Promise.reject(new Error('upstream'))),
    ).rejects.toThrow('upstream');
    expect(await circuit.getState()).toBe('OPEN');

    vi.advanceTimersByTime(RESET_TIMEOUT_MS + 1);

    await expect(
      circuit.execute(async () => Promise.reject(new Error('still-broken'))),
    ).rejects.toThrow('still-broken');
    expect(await circuit.getState()).toBe('OPEN');

    /** Failing fast confirms the circuit re-opened, not stuck in HALF_OPEN. */
    await expect(circuit.execute(async () => 'noop')).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });
});
