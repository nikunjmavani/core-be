import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@/shared/errors/index.js';
import {
  createWebauthnChallenge,
  consumeWebauthnChallenge,
  WEBAUTHN_CHALLENGE_KEY_PREFIX,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn-challenge.js';

describe('webauthn-challenge', () => {
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

  it('createWebauthnChallenge stores JSON payload with TTL', async () => {
    const token = await createWebauthnChallenge(
      redis,
      'registration',
      'user_public_abc',
      'challenge-base64url',
    );
    expect(token.length).toBeGreaterThan(10);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(WEBAUTHN_CHALLENGE_KEY_PREFIX),
      JSON.stringify({
        kind: 'registration',
        user_public_id: 'user_public_abc',
        challenge: 'challenge-base64url',
      }),
      'EX',
      expect.any(Number),
    );
  });

  it('createWebauthnChallenge returns unique tokens across invocations', async () => {
    vi.mocked(redis.set).mockResolvedValue('OK' as never);
    const a = await createWebauthnChallenge(redis, 'registration', 'user_public_abc', 'c1');
    const b = await createWebauthnChallenge(redis, 'registration', 'user_public_abc', 'c1');
    expect(a).not.toBe(b);
  });

  it('consumeWebauthnChallenge rejects empty challenge token', async () => {
    await expect(consumeWebauthnChallenge(redis, '', 'registration')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('consumeWebauthnChallenge rejects expired/missing Redis entry', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    await expect(
      consumeWebauthnChallenge(redis, 'token-abc', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('consumeWebauthnChallenge rejects malformed JSON payload', async () => {
    vi.mocked(redis.get).mockResolvedValue('{not-json');
    await expect(
      consumeWebauthnChallenge(redis, 'token-abc', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(redis.del).toHaveBeenCalled();
  });

  it('consumeWebauthnChallenge rejects when kind does not match expected', async () => {
    vi.mocked(redis.get).mockResolvedValue(
      JSON.stringify({
        kind: 'authentication',
        user_public_id: 'user_public_abc',
        challenge: 'c1',
      }),
    );
    await expect(
      consumeWebauthnChallenge(redis, 'token-abc', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    // Still deletes the token to prevent reuse
    expect(redis.del).toHaveBeenCalled();
  });

  it('consumeWebauthnChallenge deletes the token on successful consume', async () => {
    vi.mocked(redis.get).mockResolvedValue(
      JSON.stringify({
        kind: 'authentication',
        user_public_id: 'user_public_abc',
        challenge: 'c1',
      }),
    );
    const payload = await consumeWebauthnChallenge(redis, 'token-success', 'authentication');
    expect(payload.user_public_id).toBe('user_public_abc');
    expect(payload.challenge).toBe('c1');
    expect(redis.del).toHaveBeenCalledWith(`${WEBAUTHN_CHALLENGE_KEY_PREFIX}token-success`);
  });

  it('consumeWebauthnChallenge rejects replayed token after first successful consume', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(
      JSON.stringify({
        kind: 'registration',
        user_public_id: 'user_public_abc',
        challenge: 'c1',
      }),
    );
    await expect(consumeWebauthnChallenge(redis, 'replay-token', 'registration')).resolves.toEqual({
      kind: 'registration',
      user_public_id: 'user_public_abc',
      challenge: 'c1',
    });

    vi.mocked(redis.get).mockResolvedValueOnce(null);
    await expect(
      consumeWebauthnChallenge(redis, 'replay-token', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
