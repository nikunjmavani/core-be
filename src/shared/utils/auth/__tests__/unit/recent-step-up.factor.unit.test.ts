import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  recordRecentStepUp,
  hasRecentStepUp,
  hasRecentStrongStepUp,
} from '@/shared/utils/auth/recent-step-up.util.js';

/**
 * Factor gating (item #8): the step-up sentinel stores the factor that opened the window so a
 * bootstrap `email_code` step-up (a passwordless-no-MFA account enrolling its first factor) can
 * ENROLL but never satisfy the strong gate on destructive credential/session mutations.
 */
describe('recent-step-up util — factor gating', () => {
  let store: Map<string, string>;
  const mockRedis = {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  } as unknown as Redis;

  beforeEach(() => {
    store = new Map();
    vi.clearAllMocks();
  });

  it.each([
    'password',
    'mfa',
  ] as const)('a %s step-up satisfies both the normal and the strong gate', async (factor) => {
    await recordRecentStepUp(mockRedis, 'u', 's', factor);
    await expect(hasRecentStepUp(mockRedis, 'u', 's')).resolves.toBe(true);
    await expect(hasRecentStrongStepUp(mockRedis, 'u', 's')).resolves.toBe(true);
  });

  it('an email_code step-up satisfies the normal (enroll) gate but NOT the strong gate', async () => {
    await recordRecentStepUp(mockRedis, 'u', 's', 'email_code');
    await expect(hasRecentStepUp(mockRedis, 'u', 's')).resolves.toBe(true);
    await expect(hasRecentStrongStepUp(mockRedis, 'u', 's')).resolves.toBe(false);
  });

  it('hasRecentStrongStepUp fails closed with no session id', async () => {
    await recordRecentStepUp(mockRedis, 'u', 's', 'password');
    await expect(hasRecentStrongStepUp(mockRedis, 'u', undefined)).resolves.toBe(false);
  });

  it('a legacy sentinel (session-id value, written before factors) reads as non-strong', async () => {
    // A window opened just before this change stored the session id as the value, not a factor.
    // It must still satisfy the enroll gate but fail the strong gate until its 10-minute TTL lapses.
    store.set('step-up:u:s', 's');
    await expect(hasRecentStepUp(mockRedis, 'u', 's')).resolves.toBe(true);
    await expect(hasRecentStrongStepUp(mockRedis, 'u', 's')).resolves.toBe(false);
  });
});
