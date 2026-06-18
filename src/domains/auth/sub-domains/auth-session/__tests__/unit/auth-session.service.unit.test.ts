import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionRepository } from '@/domains/auth/sub-domains/auth-session/auth-session.repository.js';

vi.mock('@/domains/auth/sub-domains/auth-session/session-token-cache.service.js', () => ({
  // Returns the session public id on cache hit, or `null` on miss (sec-A2 changed the
  // sentinel from `'1'` to the session public id so callers can recover identity).
  getCachedSessionTokenValid: vi.fn().mockResolvedValue(null),
  setCachedSessionTokenValid: vi.fn().mockResolvedValue(undefined),
  invalidateCachedSessionToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
  withSessionPublicIdDatabaseContext: vi.fn(
    (_sessionPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
  withSessionTokenHashDatabaseContext: vi.fn(
    (_tokenHash: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

const user = {
  id: 1,
  public_id: 'user_public',
  email: 'user@example.com',
  status: 'ACTIVE',
  deleted_at: null,
};

describe('AuthSessionService', () => {
  const userService = {
    requireUserRecordByPublicId: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
    findUserRecordByPublicId: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const sessionRepository = {
    listByUserId: vi.fn().mockResolvedValue([{ public_id: 'session_public' }]),
    revoke: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
    revokeAllByUserId: vi.fn().mockResolvedValue([]),
    revokeAllByUserIdExceptSession: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ public_id: 'session_new' }),
    revokeByTokenHash: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
    findByPublicId: vi
      .fn()
      .mockResolvedValue({ public_id: 'session_public', token_hash: 'old-hash' }),
    findByPublicIdIncludingRevoked: vi
      .fn()
      .mockResolvedValue({ public_id: 'session_public', token_hash: 'old-hash' }),
    findActiveByTokenHash: vi.fn().mockResolvedValue({
      public_id: 'session_public',
      expires_at: new Date('2026-12-31T00:00:00.000Z'),
    }),
    rotateTokenHash: vi.fn().mockResolvedValue(undefined),
    rotateSessionCredentials: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
  } as unknown as AuthSessionRepository;

  const service = new AuthSessionService(userService, sessionRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(user as never);
    vi.mocked(userService.findById).mockResolvedValue(user as never);
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(user as never);
  });

  it('list returns sessions for user', async () => {
    const sessions = await service.list('user_public');
    expect(sessions).toHaveLength(1);
    expect(sessionRepository.listByUserId).toHaveBeenCalledWith(user.id);
  });

  it('revoke removes session for user', async () => {
    await service.revoke('user_public', 'session_public');
    expect(sessionRepository.revoke).toHaveBeenCalledWith('session_public', user.id);
  });

  it('revoke throws when user record is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.revoke('user_public', 'session_public')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('revoke throws when session missing', async () => {
    vi.mocked(sessionRepository.revoke).mockResolvedValue(null);
    await expect(service.revoke('user_public', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('revokeAllSessions revokes every session for user', async () => {
    await service.revokeAllSessions('user_public');
    expect(sessionRepository.revokeAllByUserId).toHaveBeenCalledWith(user.id);
  });

  it('list throws when user is not found', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.list('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('revokeAllSessions throws when user is not found', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(service.revokeAllSessions('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('revokeAllSessionsExceptCurrent excludes by stable session public id and invalidates revoked hashes (bug 33 + refresh race)', async () => {
    vi.mocked(sessionRepository.revokeAllByUserIdExceptSession).mockResolvedValue([
      { token_hash: 'revoked-hash-a' },
      { token_hash: 'revoked-hash-b' },
      { token_hash: null },
    ] as never);
    const { invalidateCachedSessionToken } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    await service.revokeAllSessionsExceptCurrent({
      userPublicId: 'user_public',
      currentSessionPublicId: 'ses_currentsession00000',
    });
    // The except value passed to the repository is the STABLE session public id (not a token
    // hash), so a concurrent refresh that rotates the token hash cannot evict the caller.
    const [, exceptSessionPublicId] = vi.mocked(sessionRepository.revokeAllByUserIdExceptSession)
      .mock.calls[0]!;
    expect(exceptSessionPublicId).toBe('ses_currentsession00000');
    expect(invalidateCachedSessionToken).toHaveBeenCalledWith('revoked-hash-a');
    expect(invalidateCachedSessionToken).toHaveBeenCalledWith('revoked-hash-b');
    expect(invalidateCachedSessionToken).toHaveBeenCalledTimes(2);
  });

  it('revokeAllSessionsExceptCurrent throws when user is not found', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(
      service.revokeAllSessionsExceptCurrent({
        userPublicId: 'missing',
        currentSessionPublicId: 'ses_x000000000000000000',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('createSessionForUser creates session under user database context', async () => {
    const result = await service.createSessionForUser('user_public', {
      token_hash: 'hash',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      expires_at: new Date('2026-12-31T00:00:00.000Z'),
    });
    expect(result.public_id).toBe('session_new');
    expect(sessionRepository.create).toHaveBeenCalled();
  });

  it('createSessionForUser throws when user is missing', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(
      service.createSessionForUser('missing', {
        token_hash: 'hash',
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        expires_at: new Date('2026-12-31T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('revokeSessionByAccessToken revokes by token hash', async () => {
    await service.revokeSessionByAccessToken('access-token-value');
    expect(sessionRepository.revokeByTokenHash).toHaveBeenCalled();
  });

  it('revokeSessionByAccessToken throws when session is missing', async () => {
    vi.mocked(sessionRepository.revokeByTokenHash).mockResolvedValue(null);
    await expect(service.revokeSessionByAccessToken('unknown-token')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('findActiveSessionByPublicId and rotateSessionTokenHash delegate to repository', async () => {
    const session = await service.findActiveSessionByPublicId('session_public');
    expect(session?.public_id).toBe('session_public');
    await service.rotateSessionTokenHash('session_public', 'new-hash');
    expect(sessionRepository.rotateTokenHash).toHaveBeenCalledWith('session_public', 'new-hash');
  });

  it('verifyActiveAccessToken uses cache when hit', async () => {
    const { getCachedSessionTokenValid } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    vi.mocked(getCachedSessionTokenValid).mockResolvedValueOnce('sess_cached');
    const result = await service.verifyActiveAccessToken('cached-token', 'user_public');
    expect(sessionRepository.findActiveByTokenHash).not.toHaveBeenCalled();
    expect(result).toEqual({ sessionPublicId: 'sess_cached' });
  });

  it('verifyActiveAccessToken loads session and caches with the session expiry on miss', async () => {
    const sessionExpiresAt = new Date('2026-12-31T00:00:00.000Z');
    const { getCachedSessionTokenValid, setCachedSessionTokenValid } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    vi.mocked(getCachedSessionTokenValid).mockResolvedValueOnce(null);
    vi.mocked(sessionRepository.findActiveByTokenHash).mockResolvedValueOnce({
      public_id: 'session_public',
      expires_at: sessionExpiresAt,
    } as never);
    // sec-new-A2: active user is returned on cache miss so the user status check passes
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValueOnce(user as never);
    const result = await service.verifyActiveAccessToken('fresh-token', 'user_public');
    expect(sessionRepository.findActiveByTokenHash).toHaveBeenCalled();
    expect(setCachedSessionTokenValid).toHaveBeenCalledWith(
      expect.objectContaining({ sessionExpiresAt, sessionPublicId: 'session_public' }),
    );
    expect(result).toEqual({ sessionPublicId: 'session_public' });
  });

  it('verifyActiveAccessToken throws when session is missing', async () => {
    vi.mocked(sessionRepository.findActiveByTokenHash).mockResolvedValueOnce(null);
    await expect(
      service.verifyActiveAccessToken('unknown-token', 'user_public'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyActiveAccessToken throws accountNotActive when user is suspended (sec-new-A2)', async () => {
    const { getCachedSessionTokenValid } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    vi.mocked(getCachedSessionTokenValid).mockResolvedValueOnce(null);
    vi.mocked(sessionRepository.findActiveByTokenHash).mockResolvedValueOnce({
      public_id: 'session_public',
      expires_at: new Date('2026-12-31T00:00:00.000Z'),
    } as never);
    // sec-new-A2: suspended user must be rejected even when the session row is still active
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValueOnce({
      ...user,
      status: 'SUSPENDED',
    } as never);
    await expect(
      service.verifyActiveAccessToken('active-session-token', 'suspended_user'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyActiveAccessToken throws accountNotActive when user is soft-deleted (sec-new-A2)', async () => {
    const { getCachedSessionTokenValid } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    vi.mocked(getCachedSessionTokenValid).mockResolvedValueOnce(null);
    vi.mocked(sessionRepository.findActiveByTokenHash).mockResolvedValueOnce({
      public_id: 'session_public',
      expires_at: new Date('2026-12-31T00:00:00.000Z'),
    } as never);
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValueOnce({
      ...user,
      deleted_at: new Date('2026-01-01T00:00:00.000Z'),
    } as never);
    await expect(
      service.verifyActiveAccessToken('active-session-token', 'deleted_user'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refreshSessionCredentials rotates the secret and does not revoke the family on the happy path', async () => {
    vi.mocked(sessionRepository.findByPublicId).mockResolvedValue({
      public_id: 'session_public',
      user_id: user.id,
      token_hash: 'old-token-hash',
      refresh_token_hash: 'stored-refresh-hash',
    } as never);
    vi.mocked(sessionRepository.rotateSessionCredentials).mockResolvedValue({
      public_id: 'session_public',
    } as never);

    const result = await service.refreshSessionCredentials({
      sessionPublicId: 'session_public',
      refreshSecret: 'presented-secret',
      nextAccessToken: 'next-access-token',
    });

    expect(result.refresh_secret).toMatch(/.+/);
    expect(sessionRepository.revokeAllByUserId).not.toHaveBeenCalled();
  });

  it('refreshSessionCredentials revokes the entire session family when an old refresh secret is replayed (reuse detection)', async () => {
    // sec-A finding #9: the reuse-detection lookup now uses
    // `findByPublicIdIncludingRevoked` so a stolen refresh secret replayed against
    // an already-revoked session still triggers the family-wide kill / audit signal.
    vi.mocked(sessionRepository.findByPublicIdIncludingRevoked).mockResolvedValue({
      public_id: 'session_public',
      user_id: user.id,
      token_hash: 'old-token-hash',
      refresh_token_hash: 'already-rotated-hash',
      is_revoked: false,
    } as never);
    vi.mocked(sessionRepository.rotateSessionCredentials).mockResolvedValue(null as never);
    vi.mocked(sessionRepository.revokeAllByUserId).mockResolvedValue([
      { token_hash: 'family-hash-a' },
      { token_hash: 'family-hash-b' },
      { token_hash: null },
    ] as never);
    const { invalidateCachedSessionToken } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );

    await expect(
      service.refreshSessionCredentials({
        sessionPublicId: 'session_public',
        refreshSecret: 'stolen-old-secret',
        nextAccessToken: 'next-access-token',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(userService.findById).toHaveBeenCalledWith(user.id);
    expect(sessionRepository.revokeAllByUserId).toHaveBeenCalledWith(user.id);
    expect(invalidateCachedSessionToken).toHaveBeenCalledWith('family-hash-a');
    expect(invalidateCachedSessionToken).toHaveBeenCalledWith('family-hash-b');
  });

  it('refreshSessionCredentials still raises the reuse-detection signal when the session is ALREADY revoked (sec-A #9)', async () => {
    // The prior code filtered `is_revoked = false` in the lookup, so once the user had
    // logged out everywhere the reuse-detection path silently no-op'd. We now include
    // revoked rows in the lookup, emit the Sentry signal for forensics, and skip the
    // re-revoke (the session is already revoked — re-revoking would be a no-op).
    vi.mocked(sessionRepository.findByPublicIdIncludingRevoked).mockResolvedValue({
      public_id: 'session_public',
      user_id: user.id,
      token_hash: 'old-token-hash',
      refresh_token_hash: 'already-rotated-hash',
      is_revoked: true,
    } as never);
    vi.mocked(sessionRepository.rotateSessionCredentials).mockResolvedValue(null as never);

    await expect(
      service.refreshSessionCredentials({
        sessionPublicId: 'session_public',
        refreshSecret: 'stolen-old-secret',
        nextAccessToken: 'next-access-token',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // The session is already revoked — do NOT call revokeAllByUserId a second time.
    expect(sessionRepository.revokeAllByUserId).not.toHaveBeenCalled();
  });
});
