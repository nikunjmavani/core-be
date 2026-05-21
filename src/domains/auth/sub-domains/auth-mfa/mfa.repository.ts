import { and, eq, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { auth_methods } from '@/domains/auth/sub-domains/auth-method/auth-method.schema.js';

/**
 * MFA repository — queries the auth_methods table filtered for MFA method types.
 * Will be migrated to a dedicated mfa_methods table in Phase 2.
 */
export class MfaRepository {
  private readonly mfaMethodTypes = ['MFA_TOTP', 'MFA_SMS', 'MFA_EMAIL'] as const;

  async findTotpByUserId(userId: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(
        and(
          eq(auth_methods.user_id, userId),
          eq(auth_methods.method_type, 'MFA_TOTP'),
          isNull(auth_methods.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listMfaByUserId(userId: number) {
    return getRequestDatabase()
      .select({
        id: auth_methods.id,
        method_type: auth_methods.method_type,
        last_used_at: auth_methods.last_used_at,
        created_at: auth_methods.created_at,
      })
      .from(auth_methods)
      .where(and(eq(auth_methods.user_id, userId), isNull(auth_methods.revoked_at)));
  }

  async findByIdForUser(methodId: number, userId: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(
        and(
          eq(auth_methods.id, methodId),
          eq(auth_methods.user_id, userId),
          isNull(auth_methods.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async updateLastUsedAt(methodId: number, userId: number) {
    const rows = await getRequestDatabase()
      .update(auth_methods)
      .set({ last_used_at: new Date() })
      .where(and(eq(auth_methods.id, methodId), eq(auth_methods.user_id, userId)))
      .returning();
    return rows[0] ?? null;
  }

  async revoke(methodId: number, userId: number) {
    const rows = await getRequestDatabase()
      .update(auth_methods)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(auth_methods.id, methodId),
          eq(auth_methods.user_id, userId),
          isNull(auth_methods.revoked_at),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
