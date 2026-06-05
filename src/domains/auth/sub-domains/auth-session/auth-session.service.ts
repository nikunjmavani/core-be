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
 *   downstream bearer checks see the change immediately. On refresh-secret reuse
 *   (an already-rotated secret replayed), {@link refreshSessionCredentials}
 *   revokes the user's entire session family, not just the targeted session.
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

  /**
   * Lists session metadata for a GDPR data-export bundle (includes revoked sessions; capped by
   * caller).
   */
  async listForUserDataExport(options: { userPublicId: string; limit: number }) {
    const user = await this.userService.requireUserRecordByPublicId(options.userPublicId);
    return withUserDatabaseContext(options.userPublicId, (_databaseHandle) =>
      this.sessionRepository.listForUserDataExport(user.id, options.limit),
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

  private async invalidateRevokedSessionCaches(
    revokedSessions: { token_hash: string | null }[],
  ): Promise<void> {
    await Promise.all(
      revokedSessions
        .map((session) => session.token_hash)
        .filter((tokenHash): tokenHash is string => Boolean(tokenHash))
        .map((tokenHash) => invalidateCachedSessionToken(tokenHash)),
    );
  }

  async revokeAllSessions(userPublicId: string): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const revokedSessions = await withUserDatabaseContext(userPublicId, (_databaseHandle) =>
      this.sessionRepository.revokeAllByUserId(user.id),
    );
    await this.invalidateRevokedSessionCaches(revokedSessions);
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
    await this.invalidateRevokedSessionCaches(revokedSessions);
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
   * Returns `{ sessionPublicId }` so callers (auth middleware) can attach session
   * identity to `request.auth` for step-up binding (sec-A2). The positive result is
   * cached in Redis for up to 60s — the cache value is the session's `public_id`, so a
   * cache hit avoids the Postgres round-trip AND still produces the session id.
   * The cache TTL is capped to the session's remaining lifetime so a cached "valid"
   * entry can never outlive the session (see {@link setCachedSessionTokenValid}).
   */
  async verifyActiveAccessToken(rawToken: string): Promise<{ sessionPublicId: string }> {
    const tokenHash = hashAccessToken(rawToken);
    const cachedSessionPublicId = await getCachedSessionTokenValid(tokenHash);
    if (cachedSessionPublicId !== null) {
      return { sessionPublicId: cachedSessionPublicId };
    }

    const session = await withSessionTokenHashDatabaseContext(tokenHash, (_databaseHandle) =>
      this.sessionRepository.findActiveByTokenHash(tokenHash),
    );

    if (!session) {
      throw new UnauthorizedError('errors:invalidOrExpiredSession');
    }

    await setCachedSessionTokenValid({
      tokenHash,
      sessionPublicId: session.public_id,
      sessionExpiresAt: session.expires_at,
    });
    return { sessionPublicId: session.public_id };
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
      // Reuse detection: the presented refresh secret did not match the stored hash. If the
      // session still exists with a *different* refresh hash, an already-rotated (old/stolen)
      // secret is being replayed. Revoke the user's entire session family so a leaked refresh
      // token cannot be used to keep — or regain — access on any device (OAuth refresh-token
      // rotation reuse-detection per RFC 9700).
      const reusedUserId = await withSessionPublicIdDatabaseContext(
        sessionPublicId,
        async (_databaseHandle) => {
          const existing = await this.sessionRepository.findByPublicId(sessionPublicId);
          if (existing?.refresh_token_hash && existing.refresh_token_hash !== currentRefreshHash) {
            return existing.user_id;
          }
          return null;
        },
      );
      if (reusedUserId !== null) {
        await this.revokeAllSessionsForReusedRefreshSecret(reusedUserId);
      }
      throw new UnauthorizedError('errors:invalidOrExpiredSession');
    }

    return { refresh_secret: nextRefreshSecret };
  }

  /**
   * Revokes every session for the owner of a replayed refresh secret.
   *
   * @remarks
   * - **Algorithm:** resolves the owner's public id from the internal `userId`
   *   via {@link UserService.findById} (RLS-safe SECURITY DEFINER resolver),
   *   then revokes all of that user's sessions under their own `app.current_user_id`
   *   context so the `sessions_user_access` policy authorizes the family-wide update.
   * - **Failure modes:** if the owner can no longer be resolved (already
   *   hard-deleted) the revoke is skipped — the replay is rejected regardless by
   *   the `UnauthorizedError` thrown by the caller.
   * - **Side effects:** writes `auth.sessions` rows and invalidates each revoked
   *   token's Redis cache entry.
   */
  private async revokeAllSessionsForReusedRefreshSecret(userId: number): Promise<void> {
    const user = await this.userService.findById(userId);
    if (!user) return;
    const revokedSessions = await withUserDatabaseContext(user.public_id, (_databaseHandle) =>
      this.sessionRepository.revokeAllByUserId(user.id),
    );
    await this.invalidateRevokedSessionCaches(revokedSessions);
  }
}
