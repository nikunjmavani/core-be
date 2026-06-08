import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  RECENT_STEP_UP_TTL_SECONDS,
  hasRecentStepUp,
  recordRecentStepUp,
} from '@/shared/utils/auth/recent-step-up.util.js';

/**
 * Regression for sec-A2 (High): the step-up sentinel must be keyed on
 * `(userPublicId, sessionPublicId)` — not on `userPublicId` alone. With user-only keying,
 * a holder of a stolen session who waits for the legitimate user's next routine step-up
 * (opening "Account → Add passkey", verifying MFA, etc.) gets a 10-minute window to delete
 * MFA / register a passkey / change the password through their stolen bearer, because
 * `requireRecentStepUpPreHandler` would see the legitimate user's sentinel and let the
 * attacker's request through.
 */
describe('recent-step-up util — session binding (sec-A2)', () => {
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

  it('step-up recorded for session A is NOT visible to session B (same user)', async () => {
    await recordRecentStepUp(mockRedis, 'user_pub', 'session_A');

    await expect(hasRecentStepUp(mockRedis, 'user_pub', 'session_A')).resolves.toBe(true);
    await expect(hasRecentStepUp(mockRedis, 'user_pub', 'session_B')).resolves.toBe(false);
  });

  it('step-up recorded for one user is NOT visible to a different user', async () => {
    await recordRecentStepUp(mockRedis, 'user_a', 'session_X');

    await expect(hasRecentStepUp(mockRedis, 'user_a', 'session_X')).resolves.toBe(true);
    await expect(hasRecentStepUp(mockRedis, 'user_b', 'session_X')).resolves.toBe(false);
  });

  it('hasRecentStepUp without a sessionPublicId returns false (no fallback to user-only key)', async () => {
    await recordRecentStepUp(mockRedis, 'user_pub', 'session_A');

    // Defense in depth: a future caller that forgets to pass session id must fail closed.
    await expect(hasRecentStepUp(mockRedis, 'user_pub', undefined)).resolves.toBe(false);
  });

  it('uses the documented TTL', async () => {
    await recordRecentStepUp(mockRedis, 'user_pub', 'session_A');

    // ioredis signature: set(key, value, 'EX', seconds, ...) — the TTL must appear in the args.
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('user_pub'),
      expect.any(String),
      'EX',
      RECENT_STEP_UP_TTL_SECONDS,
    );
    // And the key must include the session id so the sentinel is per-session.
    const callKey = vi.mocked(mockRedis.set).mock.calls[0]?.[0];
    expect(callKey).toContain('session_A');
  });
});
