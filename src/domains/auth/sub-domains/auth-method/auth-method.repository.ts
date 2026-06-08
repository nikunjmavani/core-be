import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { auth_methods } from '@/domains/auth/sub-domains/auth-method/auth-method.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { AuthMethodCreateData, AuthMethodProviderLookup } from './auth-method.types.js';

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
    // sec-re-04: ORDER BY ensures `limit(1)` returns the most-recently created active
    // TOTP row when historical duplicates exist (which the new partial UNIQUE index
    // prevents going forward). Without an explicit order, Postgres returned an
    // arbitrary row and login could land on a stale secret the user no longer holds —
    // soft-locking re-enrolled accounts.
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
      .orderBy(desc(auth_methods.created_at), desc(auth_methods.id))
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

  /**
   * Resolves a single active auth-method row by its opaque `public_id` for the
   * authenticated delete flow (sec-new-B4). Returns `null` when no matching
   * non-revoked row exists for this user.
   */
  async findByPublicIdForUser(publicId: string, userId: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(auth_methods)
      .where(
        and(
          eq(auth_methods.public_id, publicId),
          eq(auth_methods.user_id, userId),
          isNull(auth_methods.revoked_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Resolves a linked credential by `(provider, provider_user_id)` for the pre-session OAuth
   * callback via the `auth.resolve_auth_method_by_provider` SECURITY DEFINER resolver. `auth_methods`
   * is FORCE RLS and the callback has no `app.current_user_id` yet, so a plain SELECT would resolve
   * the owner policy to NULL and return zero rows. Returns the row plus the owning `user_public_id`.
   */
  async findByProviderUserId(
    provider: string,
    providerUserId: string,
  ): Promise<AuthMethodProviderLookup | null> {
    const result = await getRequestDatabase().execute(
      sql`SELECT * FROM auth.resolve_auth_method_by_provider(${provider}, ${providerUserId})`,
    );
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return null;
    return {
      ...(row as unknown as AuthMethodProviderLookup),
      id: Number((row as { id: unknown }).id),
      user_id: Number((row as { user_id: unknown }).user_id),
    };
  }

  /** Inserts a new auth-method row, auto-generating a crypto-secure `public_id` (sec-new-B4). */
  async create(data: AuthMethodCreateData) {
    const rows = await getRequestDatabase()
      .insert(auth_methods)
      .values({ ...data, public_id: generatePublicId() })
      .returning();
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
