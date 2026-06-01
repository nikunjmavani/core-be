import { describe, expect, it } from 'vitest';
import {
  ANTI_ENUMERATION_MINIMUM_DURATION_MS,
  enforceMinimumDuration,
} from '@/shared/utils/security/anti-enumeration.util.js';

describe('enforceMinimumDuration', () => {
  it('waits out the remaining time when the branch finished faster than the floor', async () => {
    const startedAt = Date.now();
    await enforceMinimumDuration(startedAt, 60);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(55);
  });

  it('returns immediately when the branch already exceeded the floor', async () => {
    const startedAt = Date.now() - 1_000;
    const before = Date.now();
    await enforceMinimumDuration(startedAt, 50);
    const overhead = Date.now() - before;
    // No additional sleep should be added once the floor is already surpassed.
    expect(overhead).toBeLessThan(40);
  });

  it('exposes a positive default floor used by the anti-enumeration endpoints', () => {
    expect(ANTI_ENUMERATION_MINIMUM_DURATION_MS).toBeGreaterThan(0);
  });
});
