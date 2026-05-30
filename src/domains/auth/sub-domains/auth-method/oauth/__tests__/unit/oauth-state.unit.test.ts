import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { NotImplementedError, UnauthorizedError } from '@/shared/errors/index.js';
import {
  assertOAuthProviderSupported,
  consumeOAuthState,
  createOAuthState,
  OAUTH_STATE_KEY_PREFIX,
} from '@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js';

describe('oauth-state', () => {
  const redis = {
    set: vi.fn(),
    getdel: vi.fn(),
  } as unknown as Redis;

  beforeEach(() => {
    vi.mocked(redis.set).mockReset();
    vi.mocked(redis.getdel).mockReset();
  });

  it('assertOAuthProviderSupported rejects unknown providers', () => {
    expect(() => assertOAuthProviderSupported('unknown')).toThrow(NotImplementedError);
  });

  it('createOAuthState stores provider in Redis with TTL', async () => {
    const state = await createOAuthState(redis, 'google');
    expect(state.length).toBeGreaterThan(10);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(OAUTH_STATE_KEY_PREFIX),
      'google',
      'EX',
      600,
    );
  });

  it('consumeOAuthState rejects missing state', async () => {
    await expect(consumeOAuthState(redis, 'google', undefined)).rejects.toThrow(UnauthorizedError);
  });

  it('consumeOAuthState rejects empty state string', async () => {
    await expect(consumeOAuthState(redis, 'google', '')).rejects.toThrow(UnauthorizedError);
  });

  it('consumeOAuthState rejects expired or missing Redis state', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(null);
    await expect(consumeOAuthState(redis, 'google', 'state-token')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState rejects provider mismatch', async () => {
    vi.mocked(redis.getdel).mockResolvedValue('github');
    await expect(consumeOAuthState(redis, 'google', 'state-token')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState atomically reads-and-deletes state after successful consume', async () => {
    vi.mocked(redis.getdel).mockResolvedValue('google');
    const provider = await consumeOAuthState(redis, 'google', 'state-token-123');
    expect(provider).toBe('google');
    expect(redis.getdel).toHaveBeenCalledWith(`${OAUTH_STATE_KEY_PREFIX}state-token-123`);
  });

  it('consumeOAuthState rejects replayed state after first successful consume', async () => {
    vi.mocked(redis.getdel).mockResolvedValueOnce('google');
    await expect(consumeOAuthState(redis, 'google', 'replay-state')).resolves.toBe('google');

    // Replay: GETDEL already removed the entry (atomic consume)
    vi.mocked(redis.getdel).mockResolvedValueOnce(null);
    await expect(consumeOAuthState(redis, 'google', 'replay-state')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState deletes state before validating provider mismatch (prevents reuse of mismatched state)', async () => {
    vi.mocked(redis.getdel).mockResolvedValue('google');
    await expect(consumeOAuthState(redis, 'github', 'cross-provider')).rejects.toThrow(
      UnauthorizedError,
    );
    expect(redis.getdel).toHaveBeenCalledWith(`${OAUTH_STATE_KEY_PREFIX}cross-provider`);
  });

  it('lets exactly one of two concurrent consumes succeed (atomic GETDEL)', async () => {
    let consumed = false;
    vi.mocked(redis.getdel).mockImplementation(async () => {
      if (consumed) return null;
      consumed = true;
      return 'google';
    });

    const results = await Promise.allSettled([
      consumeOAuthState(redis, 'google', 'race-state'),
      consumeOAuthState(redis, 'google', 'race-state'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('createOAuthState generates unique state tokens across invocations', async () => {
    vi.mocked(redis.set).mockResolvedValue('OK' as never);
    const stateA = await createOAuthState(redis, 'google');
    const stateB = await createOAuthState(redis, 'google');
    expect(stateA).not.toBe(stateB);
  });
});
