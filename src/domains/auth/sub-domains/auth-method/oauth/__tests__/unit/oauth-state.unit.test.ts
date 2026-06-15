import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import {
  assertOAuthProviderSupported,
  consumeOAuthState,
  createOAuthState,
  hashOAuthNonce,
  OAUTH_STATE_KEY_PREFIX,
} from '@/domains/auth/sub-domains/auth-method/oauth/oauth-state.js';

function buildStatePayload(overrides: {
  provider?: string;
  code_verifier?: string;
  nonce?: string;
}): { raw: string; nonce: string } {
  const nonce = overrides.nonce ?? 'browser-nonce';
  return {
    nonce,
    raw: JSON.stringify({
      provider: overrides.provider ?? 'google',
      code_verifier: overrides.code_verifier ?? 'verifier',
      nonce_hash: hashOAuthNonce(nonce),
    }),
  };
}

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
    expect(() => assertOAuthProviderSupported('unknown')).toThrow(NotFoundError);
  });

  it('createOAuthState stores a JSON payload with provider, verifier, and nonce hash', async () => {
    const result = await createOAuthState(redis, 'google');
    expect(result.state.length).toBeGreaterThan(10);
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.nonce.length).toBeGreaterThan(0);

    const [, storedValue, expiryFlag, ttl] = vi.mocked(redis.set).mock.calls[0] ?? [];
    expect(expiryFlag).toBe('EX');
    expect(ttl).toBe(600);
    const payload = JSON.parse(storedValue as string) as {
      provider: string;
      code_verifier: string;
      nonce_hash: string;
    };
    expect(payload.provider).toBe('google');
    expect(payload.code_verifier).toBe(result.codeVerifier);
    expect(payload.nonce_hash).toBe(hashOAuthNonce(result.nonce));
  });

  it('consumeOAuthState rejects missing state', async () => {
    await expect(consumeOAuthState(redis, 'google', undefined, 'nonce')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState rejects empty state string', async () => {
    await expect(consumeOAuthState(redis, 'google', '', 'nonce')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState rejects expired or missing Redis state', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(null);
    await expect(consumeOAuthState(redis, 'google', 'state-token', 'nonce')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState rejects malformed payloads', async () => {
    vi.mocked(redis.getdel).mockResolvedValue('not-json');
    await expect(consumeOAuthState(redis, 'google', 'state-token', 'nonce')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState rejects provider mismatch', async () => {
    const { raw } = buildStatePayload({ provider: 'github' });
    vi.mocked(redis.getdel).mockResolvedValue(raw);
    await expect(
      consumeOAuthState(redis, 'google', 'state-token', 'browser-nonce'),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('consumeOAuthState rejects a missing browser nonce (login-CSRF defence)', async () => {
    const { raw } = buildStatePayload({});
    vi.mocked(redis.getdel).mockResolvedValue(raw);
    await expect(consumeOAuthState(redis, 'google', 'state-token', undefined)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState rejects a mismatched browser nonce', async () => {
    const { raw } = buildStatePayload({});
    vi.mocked(redis.getdel).mockResolvedValue(raw);
    await expect(
      consumeOAuthState(redis, 'google', 'state-token', 'attacker-nonce'),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('consumeOAuthState returns provider + verifier when state, provider, and nonce all match', async () => {
    const { raw, nonce } = buildStatePayload({ code_verifier: 'the-verifier' });
    vi.mocked(redis.getdel).mockResolvedValue(raw);
    const result = await consumeOAuthState(redis, 'google', 'state-token-123', nonce);
    expect(result.provider).toBe('google');
    expect(result.codeVerifier).toBe('the-verifier');
    expect(redis.getdel).toHaveBeenCalledWith(`${OAUTH_STATE_KEY_PREFIX}state-token-123`);
  });

  it('consumeOAuthState rejects replayed state after first successful consume', async () => {
    const { raw, nonce } = buildStatePayload({});
    vi.mocked(redis.getdel).mockResolvedValueOnce(raw);
    await expect(consumeOAuthState(redis, 'google', 'replay-state', nonce)).resolves.toMatchObject({
      provider: 'google',
    });

    vi.mocked(redis.getdel).mockResolvedValueOnce(null);
    await expect(consumeOAuthState(redis, 'google', 'replay-state', nonce)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('consumeOAuthState deletes state before validating provider mismatch', async () => {
    const { raw } = buildStatePayload({ provider: 'google' });
    vi.mocked(redis.getdel).mockResolvedValue(raw);
    await expect(
      consumeOAuthState(redis, 'github', 'cross-provider', 'browser-nonce'),
    ).rejects.toThrow(UnauthorizedError);
    expect(redis.getdel).toHaveBeenCalledWith(`${OAUTH_STATE_KEY_PREFIX}cross-provider`);
  });

  it('lets exactly one of two concurrent consumes succeed (atomic GETDEL)', async () => {
    const { raw, nonce } = buildStatePayload({});
    let consumed = false;
    vi.mocked(redis.getdel).mockImplementation(async () => {
      if (consumed) return null;
      consumed = true;
      return raw;
    });

    const results = await Promise.allSettled([
      consumeOAuthState(redis, 'google', 'race-state', nonce),
      consumeOAuthState(redis, 'google', 'race-state', nonce),
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
    expect(stateA.state).not.toBe(stateB.state);
    expect(stateA.nonce).not.toBe(stateB.nonce);
    expect(stateA.codeVerifier).not.toBe(stateB.codeVerifier);
  });
});
