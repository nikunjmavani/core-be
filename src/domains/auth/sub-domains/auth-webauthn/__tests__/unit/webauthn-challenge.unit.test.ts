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
    getdel: vi.fn(),
  } as unknown as Redis;

  beforeEach(() => {
    vi.mocked(redis.set).mockReset();
    vi.mocked(redis.getdel).mockReset();
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
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('consumeWebauthnChallenge rejects expired/missing Redis entry', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(null);
    await expect(
      consumeWebauthnChallenge(redis, 'token-abc', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('consumeWebauthnChallenge rejects malformed JSON payload', async () => {
    vi.mocked(redis.getdel).mockResolvedValue('{not-json');
    await expect(
      consumeWebauthnChallenge(redis, 'token-abc', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('consumeWebauthnChallenge rejects when kind does not match expected', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(
      JSON.stringify({
        kind: 'authentication',
        user_public_id: 'user_public_abc',
        challenge: 'c1',
      }),
    );
    await expect(
      consumeWebauthnChallenge(redis, 'token-abc', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    // GETDEL already removed the token, so a mismatched kind cannot be reused
    expect(redis.getdel).toHaveBeenCalled();
  });

  it('consumeWebauthnChallenge atomically reads-and-deletes the token on successful consume', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(
      JSON.stringify({
        kind: 'authentication',
        user_public_id: 'user_public_abc',
        challenge: 'c1',
      }),
    );
    const payload = await consumeWebauthnChallenge(redis, 'token-success', 'authentication');
    expect(payload.user_public_id).toBe('user_public_abc');
    expect(payload.challenge).toBe('c1');
    expect(redis.getdel).toHaveBeenCalledWith(`${WEBAUTHN_CHALLENGE_KEY_PREFIX}token-success`);
  });

  it('consumeWebauthnChallenge rejects replayed token after first successful consume', async () => {
    vi.mocked(redis.getdel).mockResolvedValueOnce(
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

    vi.mocked(redis.getdel).mockResolvedValueOnce(null);
    await expect(
      consumeWebauthnChallenge(redis, 'replay-token', 'registration'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('consumeWebauthnChallenge lets exactly one of two concurrent consumes succeed (atomic GETDEL)', async () => {
    let consumed = false;
    vi.mocked(redis.getdel).mockImplementation(async () => {
      if (consumed) return null;
      consumed = true;
      return JSON.stringify({
        kind: 'authentication',
        user_public_id: 'user_public_abc',
        challenge: 'c1',
      });
    });

    const results = await Promise.allSettled([
      consumeWebauthnChallenge(redis, 'race-token', 'authentication'),
      consumeWebauthnChallenge(redis, 'race-token', 'authentication'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
