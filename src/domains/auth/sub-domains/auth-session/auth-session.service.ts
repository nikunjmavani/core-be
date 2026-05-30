import { createHash } from 'node:crypto';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import type { UserService } from '@/domains/user/user.service.js';
import { generateRefreshSecret } from '@/domains/auth/auth.http.util.js';
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

function hashRefreshSecret(refreshSecret: string): string {
  return createHash('sha256').update(refreshSecret).digest('hex');
}

/**
 * Owns the lifecycle of `auth.sessions` rows used for bearer-token refresh,
 * device listing, and revocation.
 *
 * @remarks
 * - **Algorithm:** each access token is paired with a session row whose
 *   `token_hash` (SHA-256 of the JWT) is the join key. On refresh the row stays
 *   put while the hash is rotated (see {@link rotateSessionTokenHash}); on
 *   logout the row is revoked. All reads/writes run under user- or
 *   session-scoped database contexts so Postgres RLS lets them through.
 * - **Failure modes:** missing user / missing session surface `NotFoundError`;
 *   `revokeSessionByAccessToken` and `verifyActiveAccessToken` throw
 *   `UnauthorizedError` with `errors:invalidOrRevokedToken` / `errors:invalidOrExpiredSession`.
 * - **Side effects:** writes to `auth.sessions`; invalidates the Redis token
 *   cache via {@link invalidateCachedSessionToken} on every revoke / rotate so
 *   downstream bearer checks see the change immediately.
 * - **Notes:** {@link verifyActiveAccessToken} is hot-pathed by the auth
 *   middleware and uses a 60-second Redis cache to amortise DB round-trips.
 */
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

  /**
   * Revokes every active session for a user except the one identified by the
   * supplied bearer access token, and invalidates their token caches.
   *
   * @remarks
   * - **Algorithm:** hashes `currentAccessToken` (SHA-256) and runs a single
   *   `UPDATE … WHERE user_id = ? AND is_revoked = false AND token_hash <> ?`,
   *   then invalidates the Redis token cache for each revoked hash.
   * - **Failure modes:** throws `NotFoundError('User')` when the user no longer
   *   exists. If the current token's session was already rotated/revoked, this
   *   simply revokes the remaining sessions.
   * - **Side effects:** writes `auth.sessions` rows; invalidates cached
   *   token-validity entries so revocation takes effect immediately.
   * - **Notes:** used by the authenticated change-password flow to terminate all
   *   other devices while keeping the caller's current session alive.
   */
  async revokeAllSessionsExceptCurrent({
    userPublicId,
    currentAccessToken,
  }: {
    userPublicId: string;
    currentAccessToken: string;
  }): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const currentTokenHash = hashAccessToken(currentAccessToken);
    const revokedSessions = await withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.revokeAllByUserIdExcept(user.id, currentTokenHash),
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
    data: Omit<AuthSessionCreateData, 'user_id' | 'refresh_token_hash'>,
  ): Promise<{ public_id: string; refresh_secret: string }> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const refreshSecret = generateRefreshSecret();
    const session = await withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.create({
        user_id: user.id,
        refresh_token_hash: hashRefreshSecret(refreshSecret),
        ...data,
      }),
    );
    return { public_id: session.public_id, refresh_secret: refreshSecret };
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
   * Ensures the bearer token matches an active, non-revoked session row.
   *
   * @remarks
   * The positive result is cached in Redis for up to 60s, but the cache TTL is
   * capped to the session's remaining lifetime so a cached "valid" entry can
   * never outlive the session (see {@link setCachedSessionTokenValid}).
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

    await setCachedSessionTokenValid({ tokenHash, sessionExpiresAt: session.expires_at });
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

  async refreshSessionCredentials({
    sessionPublicId,
    refreshSecret,
    nextAccessToken,
  }: {
    sessionPublicId: string;
    refreshSecret: string;
    nextAccessToken: string;
  }): Promise<{ refresh_secret: string }> {
    const currentRefreshHash = hashRefreshSecret(refreshSecret);
    const nextRefreshSecret = generateRefreshSecret();
    const nextRefreshHash = hashRefreshSecret(nextRefreshSecret);
    const nextTokenHash = hashAccessToken(nextAccessToken);

    const rotated = await withSessionPublicIdDatabaseContext(
      sessionPublicId,
      async (_databaseHandle) => {
        const existing = await this.sessionRepository.findByPublicId(sessionPublicId);
        if (!existing?.refresh_token_hash) {
          return null;
        }
        if (existing.token_hash) {
          await invalidateCachedSessionToken(existing.token_hash);
        }
        return this.sessionRepository.rotateSessionCredentials(
          sessionPublicId,
          currentRefreshHash,
          nextTokenHash,
          nextRefreshHash,
        );
      },
    );

    if (!rotated) {
      await withSessionPublicIdDatabaseContext(sessionPublicId, async (_databaseHandle) => {
        const existing = await this.sessionRepository.findByPublicId(sessionPublicId);
        if (existing?.refresh_token_hash && existing.refresh_token_hash !== currentRefreshHash) {
          await this.sessionRepository.revoke(sessionPublicId, existing.user_id);
          if (existing.token_hash) {
            await invalidateCachedSessionToken(existing.token_hash);
          }
        }
      });
      throw new UnauthorizedError('errors:invalidOrExpiredSession');
    }

    return { refresh_secret: nextRefreshSecret };
  }
}
