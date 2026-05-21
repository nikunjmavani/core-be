import { and, eq, gt, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { verification_tokens } from './verification-token.schema.js';

export type VerificationTokenType =
  | 'MAGIC_LINK'
  | 'PASSWORD_RESET'
  | 'EMAIL_VERIFICATION'
  | 'EMAIL_CHANGE';

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

  async markUsed(tokenHash: string) {
    const rows = await getRequestDatabase()
      .update(verification_tokens)
      .set({ used_at: new Date() })
      .where(eq(verification_tokens.token_hash, tokenHash))
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
}
