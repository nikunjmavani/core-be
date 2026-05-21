import { describe, expect, it, vi } from 'vitest';

import { readinessProbeTimeout } from '@/shared/utils/infrastructure/readiness-probe-timeout.util.js';

describe('readinessProbeTimeout', () => {
  it('rejects when the promise does not resolve before the deadline', async () => {
    vi.useFakeTimers();
    try {
      const neverResolvesPromise = new Promise<boolean>(() => {
        /* intentionally hanging */
      });

      const racePromise = readinessProbeTimeout(neverResolvesPromise, 50, 'slow_probe_label');

      const rejectionExpectationPromise = expect(racePromise).rejects.toThrow(
        'health_ready_timeout:slow_probe_label',
      );

      await vi.advanceTimersByTimeAsync(50);

      await rejectionExpectationPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves when the promise settles before the deadline', async () => {
    const fastResolvedPromise = Promise.resolve(42);

    await expect(
      readinessProbeTimeout(fastResolvedPromise, 1_000, 'fast_probe_label'),
    ).resolves.toBe(42);
  });
});
