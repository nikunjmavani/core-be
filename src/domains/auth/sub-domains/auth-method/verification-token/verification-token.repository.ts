import { and, eq, gt, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { verification_tokens } from './verification-token.schema.js';

/** Enum of token categories that share the unified {@link verification_tokens} table. */
export type VerificationTokenType =
  | 'MAGIC_LINK'
  | 'PASSWORD_RESET'
  | 'EMAIL_VERIFICATION'
  | 'EMAIL_CHANGE';

/**
 * Drizzle repository for the shared `verification_tokens` table.
 *
 * @remarks
 * - **Algorithm:** `consumeIfValid` performs an atomic `UPDATE … SET used_at`
 *   guarded by `expires_at > now()` and `used_at IS NULL`, which serializes
 *   concurrent consumers via row locking; only the winning caller observes the
 *   row.
 * - **Failure modes:** returns `null` when the token hash is unknown, expired,
 *   or already used — the caller maps this to `UnauthorizedError`.
 * - **Side effects:** writes only via Drizzle; honours request-scoped RLS via
 *   {@link getRequestDatabase}. `invalidateAllForUser` revokes outstanding
 *   tokens of a category in bulk before a new one is minted.
 * - **Notes:** invariant — a token may be consumed at most once. The replay
 *   tests in `verification-token.replay.db.unit.test.ts` assert this property.
 */
export class VerificationTokenRepository {
  async create(
    tokenType: VerificationTokenType,
    userId: number,
    email: string,
    tokenHash: string,
    expiresAt: Date,
  ) {
    const rows = await getRequestDatabase()
      .insert(verification_tokens)
      .values({
        token_type: tokenType,
        token_hash: tokenHash,
        user_id: userId,
        email,
        expires_at: expiresAt,
      })
      .returning();
    return rows[0]!;
  }

  async findValidByTokenHash(tokenHash: string) {
    const rows = await getRequestDatabase()
      .select()
      .from(verification_tokens)
      .where(
        and(
          eq(verification_tokens.token_hash, tokenHash),
          gt(verification_tokens.expires_at, new Date()),
          isNull(verification_tokens.used_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Atomically consume a token: mark used only if it is still valid and unused.
   * Returns the row when this caller actually consumed the token; returns null
   * when the token is missing, expired, or was already consumed by a concurrent caller.
   * Use this instead of `findValidByTokenHash` + `markUsed` to prevent TOCTOU double-consume races.
   */
  async consumeIfValid(tokenHash: string) {
    const rows = await getRequestDatabase()
      .update(verification_tokens)
      .set({ used_at: new Date() })
      .where(
        and(
          eq(verification_tokens.token_hash, tokenHash),
          gt(verification_tokens.expires_at, new Date()),
          isNull(verification_tokens.used_at),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Invalidate all unused tokens of a given type for a user. */
  async invalidateAllForUser(userId: number, tokenType: VerificationTokenType) {
    await getRequestDatabase()
      .update(verification_tokens)
      .set({ used_at: new Date() })
      .where(
        and(
          eq(verification_tokens.user_id, userId),
          eq(verification_tokens.token_type, tokenType),
          isNull(verification_tokens.used_at),
        ),
      );
  }

  /**
   * Invalidate ALL outstanding tokens for a user across every token type. Used by the
   * offboarding sequence (sec-U1) so a magic-link / password-reset / email-verify token
   * issued seconds before soft-delete cannot mint a session for the deleted user.
   */
  async invalidateAllByUser(userId: number) {
    await getRequestDatabase()
      .update(verification_tokens)
      .set({ used_at: new Date() })
      .where(and(eq(verification_tokens.user_id, userId), isNull(verification_tokens.used_at)));
  }
}
