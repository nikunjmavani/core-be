import { describe, expect, it } from 'vitest';
import {
  isDeadLetterJobEligibleForAutoRetry,
  type DlqAutoRetryState,
} from '@/infrastructure/queue/dlq/dlq-auto-retry.store.js';

describe('dlq-auto-retry.store eligibility', () => {
  const failedAt = new Date('2026-05-01T12:00:00.000Z');
  const cooldownMs = 30 * 60_000;

  it('allows first auto-retry after failure cooldown elapses', () => {
    const nowMs = failedAt.getTime() + cooldownMs;
    expect(
      isDeadLetterJobEligibleForAutoRetry({
        state: null,
        failedAt,
        maxCount: 3,
        cooldownMs,
        nowMs,
      }),
    ).toBe(true);
  });

  it('blocks when auto-retry budget is exhausted', () => {
    const state: DlqAutoRetryState = {
      count: 3,
      lastAttemptAt: '2026-05-01T13:00:00.000Z',
    };
    expect(
      isDeadLetterJobEligibleForAutoRetry({
        state,
        failedAt,
        maxCount: 3,
        cooldownMs,
        nowMs: Date.parse('2026-05-01T14:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('blocks when cooldown since last auto-retry has not elapsed', () => {
    const state: DlqAutoRetryState = {
      count: 1,
      lastAttemptAt: '2026-05-01T13:00:00.000Z',
    };
    expect(
      isDeadLetterJobEligibleForAutoRetry({
        state,
        failedAt,
        maxCount: 3,
        cooldownMs,
        nowMs: Date.parse('2026-05-01T13:15:00.000Z'),
      }),
    ).toBe(false);
  });
});
