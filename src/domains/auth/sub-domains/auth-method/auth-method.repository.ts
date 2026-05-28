import { and, eq, isNull } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { auth_methods } from '@/domains/auth/sub-domains/auth-method/auth-method.schema.js';
import type { AuthMethodCreateData } from './auth-method.types.js';

/** Drizzle repository for the {@link auth_methods} table; reads and writes use the request-scoped database handle so Postgres RLS enforces organization isolation. Soft-deletes via `revoked_at` rather than physical deletion. */
export class AuthMethodRepository {
  async listByUserId(userId: number) {
    return getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(and(eq(auth_methods.user_id, userId), isNull(auth_methods.revoked_at)));
  }

  async listMfaByUserId(userId: number) {
    return getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(
        and(
          eq(auth_methods.user_id, userId),
          eq(auth_methods.method_type, 'MFA_TOTP'),
          isNull(auth_methods.revoked_at),
        ),
      );
  }

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

  async updateLastUsedAt(id: number, userId: number) {
    const rows = await getRequestDatabase()
      .update(auth_methods)
      .set({ last_used_at: new Date() })
      .where(and(eq(auth_methods.id, id), eq(auth_methods.user_id, userId)))
      .returning();
    return rows[0] ?? null;
  }

  async findByIdForUser(id: number, userId: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(
        and(
          eq(auth_methods.id, id),
          eq(auth_methods.user_id, userId),
          isNull(auth_methods.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByProviderUserId(provider: string, providerUserId: string) {
    const rows = await getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(
        and(
          eq(auth_methods.provider, provider),
          eq(auth_methods.provider_user_id, providerUserId),
          isNull(auth_methods.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: AuthMethodCreateData) {
    const rows = await getRequestDatabase().insert(auth_methods).values(data).returning();
    return rows[0]!;
  }

  async revoke(id: number, userId: number) {
    const rows = await getRequestDatabase()
      .update(auth_methods)
      .set({ revoked_at: new Date() })
      .where(and(eq(auth_methods.id, id), eq(auth_methods.user_id, userId)))
      .returning();
    return rows[0] ?? null;
  }

  async revokeAllByUserId(userId: number): Promise<number> {
    const rows = await getRequestDatabase()
      .update(auth_methods)
      .set({ revoked_at: new Date() })
      .where(and(eq(auth_methods.user_id, userId), isNull(auth_methods.revoked_at)))
      .returning({ id: auth_methods.id });
    return rows.length;
  }
}
