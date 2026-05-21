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
    get: vi.fn(),
    del: vi.fn(),
  } as unknown as Redis;

  beforeEach(() => {
    vi.mocked(redis.set).mockReset();
    vi.mocked(redis.get).mockReset();
    vi.mocked(redis.del).mockReset();
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
    vi.mocked(redis.get).mockResolvedValue(null);
    await expect(consumeOAuthState(redis, 'google', 'state-token')).rejects.toThrow(
      UnauthorizedError,
    );
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('consumeOAuthState rejects provider mismatch', async () => {
    vi.mocked(redis.get).mockResolvedValue('github');
    await expect(consumeOAuthState(redis, 'google', 'state-token')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState deletes state after successful consume', async () => {
    vi.mocked(redis.get).mockResolvedValue('google');
    const provider = await consumeOAuthState(redis, 'google', 'state-token-123');
    expect(provider).toBe('google');
    expect(redis.del).toHaveBeenCalledWith(`${OAUTH_STATE_KEY_PREFIX}state-token-123`);
  });

  it('consumeOAuthState rejects replayed state after first successful consume', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce('google');
    await expect(consumeOAuthState(redis, 'google', 'replay-state')).resolves.toBe('google');

    // Replay: Redis no longer has the entry (state was deleted)
    vi.mocked(redis.get).mockResolvedValueOnce(null);
    await expect(consumeOAuthState(redis, 'google', 'replay-state')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState deletes state before validating provider mismatch (prevents reuse of mismatched state)', async () => {
    vi.mocked(redis.get).mockResolvedValue('google');
    await expect(consumeOAuthState(redis, 'github', 'cross-provider')).rejects.toThrow(
      UnauthorizedError,
    );
    expect(redis.del).toHaveBeenCalledWith(`${OAUTH_STATE_KEY_PREFIX}cross-provider`);
  });

  it('createOAuthState generates unique state tokens across invocations', async () => {
    vi.mocked(redis.set).mockResolvedValue('OK' as never);
    const stateA = await createOAuthState(redis, 'google');
    const stateB = await createOAuthState(redis, 'google');
    expect(stateA).not.toBe(stateB);
  });
});
