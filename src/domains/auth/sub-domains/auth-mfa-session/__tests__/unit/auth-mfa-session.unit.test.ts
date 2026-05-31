import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@/shared/errors/index.js';
import {
  createMfaSession,
  verifyMfaSession,
  MFA_SESSION_KEY_PREFIX,
} from '@/domains/auth/sub-domains/auth-mfa-session/auth-mfa-session.js';

describe('auth-mfa-session', () => {
  const redis = {
    set: vi.fn(),
    getdel: vi.fn(),
  } as unknown as Redis;

  beforeEach(() => {
    vi.mocked(redis.set).mockReset();
    vi.mocked(redis.getdel).mockReset();
  });

  it('createMfaSession stores user_public_id JSON payload with TTL', async () => {
    const token = await createMfaSession(redis, 'user_public_abc');
    expect(token.length).toBeGreaterThan(10);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(MFA_SESSION_KEY_PREFIX),
      JSON.stringify({ user_public_id: 'user_public_abc' }),
      'EX',
      expect.any(Number),
    );
  });

  it('createMfaSession returns unique tokens across invocations', async () => {
    vi.mocked(redis.set).mockResolvedValue('OK' as never);
    const a = await createMfaSession(redis, 'user_public_abc');
    const b = await createMfaSession(redis, 'user_public_abc');
    expect(a).not.toBe(b);
  });

  it('verifyMfaSession rejects missing token', async () => {
    await expect(verifyMfaSession(redis, '')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it('verifyMfaSession rejects expired or missing Redis entry', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(null);
    await expect(verifyMfaSession(redis, 'token-abc')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyMfaSession rejects malformed JSON payload', async () => {
    vi.mocked(redis.getdel).mockResolvedValue('{not-json');
    await expect(verifyMfaSession(redis, 'token-abc')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyMfaSession rejects payload missing user_public_id', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(JSON.stringify({}));
    await expect(verifyMfaSession(redis, 'token-abc')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyMfaSession rejects payload with empty user_public_id', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(JSON.stringify({ user_public_id: '' }));
    await expect(verifyMfaSession(redis, 'token-abc')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyMfaSession atomically reads-and-deletes the token on successful consume', async () => {
    vi.mocked(redis.getdel).mockResolvedValue(
      JSON.stringify({ user_public_id: 'user_public_abc' }),
    );
    const payload = await verifyMfaSession(redis, 'token-success');
    expect(payload.user_public_id).toBe('user_public_abc');
    expect(redis.getdel).toHaveBeenCalledWith(`${MFA_SESSION_KEY_PREFIX}token-success`);
  });

  it('verifyMfaSession rejects replayed token after first successful consume', async () => {
    vi.mocked(redis.getdel).mockResolvedValueOnce(
      JSON.stringify({ user_public_id: 'user_public_abc' }),
    );
    await expect(verifyMfaSession(redis, 'replay-token')).resolves.toEqual({
      user_public_id: 'user_public_abc',
    });

    // Second call: GETDEL already removed the entry, Redis returns null
    vi.mocked(redis.getdel).mockResolvedValueOnce(null);
    await expect(verifyMfaSession(redis, 'replay-token')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyMfaSession lets exactly one of two concurrent consumes succeed (atomic GETDEL)', async () => {
    // Simulate Redis GETDEL atomicity: only the first caller observes the value,
    // every subsequent caller observes null because the key is already gone.
    let consumed = false;
    vi.mocked(redis.getdel).mockImplementation(async () => {
      if (consumed) return null;
      consumed = true;
      return JSON.stringify({ user_public_id: 'user_public_abc' });
    });

    const results = await Promise.allSettled([
      verifyMfaSession(redis, 'race-token'),
      verifyMfaSession(redis, 'race-token'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
