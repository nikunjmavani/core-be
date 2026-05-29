import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionRepository } from '@/domains/auth/sub-domains/auth-session/auth-session.repository.js';

vi.mock('@/domains/auth/sub-domains/auth-session/session-token-cache.service.js', () => ({
  getCachedSessionTokenValid: vi.fn().mockResolvedValue(false),
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

const user = { id: 1, public_id: 'user_public', email: 'user@example.com' };

describe('AuthSessionService', () => {
  const userService = {
    requireUserRecordByPublicId: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const sessionRepository = {
    listByUserId: vi.fn().mockResolvedValue([{ public_id: 'session_public' }]),
    revoke: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
    revokeAllByUserId: vi.fn().mockResolvedValue([]),
    revokeAllByUserIdExcept: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ public_id: 'session_new' }),
    revokeByTokenHash: vi.fn().mockResolvedValue({ public_id: 'session_public' }),
    findByPublicId: vi
      .fn()
      .mockResolvedValue({ public_id: 'session_public', token_hash: 'old-hash' }),
    findActiveByTokenHash: vi.fn().mockResolvedValue({
      public_id: 'session_public',
      expires_at: new Date('2026-12-31T00:00:00.000Z'),
    }),
    rotateTokenHash: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthSessionRepository;

  const service = new AuthSessionService(userService, sessionRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(user as never);
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

  it('revokeAllSessionsExceptCurrent keeps the current token and invalidates revoked hashes (bug 33)', async () => {
    vi.mocked(sessionRepository.revokeAllByUserIdExcept).mockResolvedValue([
      { token_hash: 'revoked-hash-a' },
      { token_hash: 'revoked-hash-b' },
      { token_hash: null },
    ] as never);
    const { invalidateCachedSessionToken } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    await service.revokeAllSessionsExceptCurrent({
      userPublicId: 'user_public',
      currentAccessToken: 'current-bearer-token',
    });
    // The except-hash passed to the repository is the SHA-256 of the current token, never the raw token.
    const [, exceptHash] = vi.mocked(sessionRepository.revokeAllByUserIdExcept).mock.calls[0]!;
    expect(exceptHash).not.toBe('current-bearer-token');
    expect(exceptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invalidateCachedSessionToken).toHaveBeenCalledWith('revoked-hash-a');
    expect(invalidateCachedSessionToken).toHaveBeenCalledWith('revoked-hash-b');
    expect(invalidateCachedSessionToken).toHaveBeenCalledTimes(2);
  });

  it('revokeAllSessionsExceptCurrent throws when user is not found', async () => {
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(null as never);
    await expect(
      service.revokeAllSessionsExceptCurrent({
        userPublicId: 'missing',
        currentAccessToken: 'token',
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
    vi.mocked(getCachedSessionTokenValid).mockResolvedValueOnce(true);
    await service.verifyActiveAccessToken('cached-token');
    expect(sessionRepository.findActiveByTokenHash).not.toHaveBeenCalled();
  });

  it('verifyActiveAccessToken loads session and caches with the session expiry on miss', async () => {
    const sessionExpiresAt = new Date('2026-12-31T00:00:00.000Z');
    const { getCachedSessionTokenValid, setCachedSessionTokenValid } = await import(
      '@/domains/auth/sub-domains/auth-session/session-token-cache.service.js'
    );
    vi.mocked(getCachedSessionTokenValid).mockResolvedValueOnce(false);
    vi.mocked(sessionRepository.findActiveByTokenHash).mockResolvedValueOnce({
      public_id: 'session_public',
      expires_at: sessionExpiresAt,
    } as never);
    await service.verifyActiveAccessToken('fresh-token');
    expect(sessionRepository.findActiveByTokenHash).toHaveBeenCalled();
    expect(setCachedSessionTokenValid).toHaveBeenCalledWith(
      expect.objectContaining({ sessionExpiresAt }),
    );
  });

  it('verifyActiveAccessToken throws when session is missing', async () => {
    vi.mocked(sessionRepository.findActiveByTokenHash).mockResolvedValueOnce(null);
    await expect(service.verifyActiveAccessToken('unknown-token')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
