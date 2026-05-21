import { describe, it, expect, vi } from 'vitest';
import {
  isTransientNetworkError,
  retryWithBackoff,
} from '@/infrastructure/resilience/retry-with-backoff.util.js';

describe('retryWithBackoff', () => {
  it('should retry transient failures then succeed', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce('ok');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should not retry when shouldRetry returns false', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('validation'));

    await expect(
      retryWithBackoff(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('validation');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('isTransientNetworkError', () => {
  it('should detect common network error messages', () => {
    expect(isTransientNetworkError(new Error('fetch failed'))).toBe(true);
    expect(isTransientNetworkError(new Error('ECONNRESET'))).toBe(true);
    const timeoutError = new Error('timed out');
    timeoutError.name = 'TimeoutError';
    expect(isTransientNetworkError(timeoutError)).toBe(true);
    expect(isTransientNetworkError(new Error('invalid email'))).toBe(false);
  });
});
