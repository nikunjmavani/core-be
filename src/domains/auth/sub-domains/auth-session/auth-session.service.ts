import { createHash } from 'node:crypto';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import type { UserService } from '@/domains/user/user.service.js';
import {
  withSessionPublicIdDatabaseContext,
  withSessionTokenHashDatabaseContext,
  withUserDatabaseContext,
} from '@/infrastructure/database/contexts/user-database.context.js';
import type { AuthSessionRepository } from './auth-session.repository.js';
import type { AuthSessionCreateData } from './auth-session.types.js';
import {
  getCachedSessionTokenValid,
  invalidateCachedSessionToken,
  setCachedSessionTokenValid,
} from './session-token-cache.service.js';

function hashAccessToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export class AuthSessionService {
  constructor(
    private readonly userService: UserService,
    private readonly sessionRepository: AuthSessionRepository,
  ) {}

  async list(userPublicId: string) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    return withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.listByUserId(user.id),
    );
  }

  async revoke(userPublicId: string, sessionPublicId: string) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const revoked = await withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.revoke(sessionPublicId, user.id),
    );
    if (!revoked) throw new NotFoundError('Session');
    if (revoked.token_hash) {
      await invalidateCachedSessionToken(revoked.token_hash);
    }
  }

  async revokeAllSessions(userPublicId: string): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const revokedSessions = await withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.revokeAllByUserId(user.id),
    );
    await Promise.all(
      revokedSessions
        .map((session) => session.token_hash)
        .filter((tokenHash): tokenHash is string => Boolean(tokenHash))
        .map((tokenHash) => invalidateCachedSessionToken(tokenHash)),
    );
  }

  async createSessionForUser(
    userPublicId: string,
    data: Omit<AuthSessionCreateData, 'user_id'>,
  ): Promise<{ public_id: string }> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const session = await withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.create({
        user_id: user.id,
        ...data,
      }),
    );
    return { public_id: session.public_id };
  }

  async revokeSessionByAccessToken(token: string): Promise<void> {
    const tokenHash = hashAccessToken(token);
    await invalidateCachedSessionToken(tokenHash);
    const revoked = await withSessionTokenHashDatabaseContext(tokenHash, (_databaseHandle) =>
      this.sessionRepository.revokeByTokenHash(tokenHash),
    );
    if (!revoked) {
      throw new UnauthorizedError('errors:invalidOrRevokedToken');
    }
  }

  /**
   * Ensures the bearer token matches an active, non-revoked session row (Redis-cached 60s).
   */
  async verifyActiveAccessToken(rawToken: string): Promise<void> {
    const tokenHash = hashAccessToken(rawToken);
    if (await getCachedSessionTokenValid(tokenHash)) {
      return;
    }

    const session = await withSessionTokenHashDatabaseContext(tokenHash, (_databaseHandle) =>
      this.sessionRepository.findActiveByTokenHash(tokenHash),
    );

    if (!session) {
      throw new UnauthorizedError('errors:invalidOrExpiredSession');
    }

    await setCachedSessionTokenValid(tokenHash);
  }

  async findActiveSessionByPublicId(sessionPublicId: string) {
    return withSessionPublicIdDatabaseContext(sessionPublicId, (_databaseHandle) =>
      this.sessionRepository.findByPublicId(sessionPublicId),
    );
  }

  async rotateSessionTokenHash(sessionPublicId: string, tokenHash: string): Promise<void> {
    await withSessionPublicIdDatabaseContext(sessionPublicId, async (_databaseHandle) => {
      const existing = await this.sessionRepository.findByPublicId(sessionPublicId);
      if (existing?.token_hash) {
        await invalidateCachedSessionToken(existing.token_hash);
      }
      await this.sessionRepository.rotateTokenHash(sessionPublicId, tokenHash);
    });
  }
}
