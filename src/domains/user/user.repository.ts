import { createHash } from 'node:crypto';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { and, eq, isNull, like, or, count } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { users } from '@/domains/user/user.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { escapeLikePattern } from '@/shared/utils/validation/validation.util.js';

export class UserRepository {
  async findByPublicId(public_id: string) {
    const rows = await getRequestDatabase()
      .select()
      .from(users)
      .where(and(eq(users.public_id, public_id), isNull(users.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const rows = await getRequestDatabase()
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(identifier: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(users)
      .where(eq(users.id, identifier))
      .limit(1);
    return rows[0] ?? null;
  }

  async updatePassword(publicId: string, passwordHash: string) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({
        password_hash: passwordHash,
        last_password_change_at: new Date(),
        updated_at: databaseNowTimestamp,
      })
      .where(and(eq(users.public_id, publicId), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  async updateEmailVerified(publicId: string) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({
        is_email_verified: true,
        updated_at: databaseNowTimestamp,
      })
      .where(and(eq(users.public_id, publicId), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  private async updateByPublicId(
    public_id: string,
    data: Record<string, unknown>,
  ): Promise<typeof users.$inferSelect | null> {
    const rows = await getRequestDatabase()
      .update(users)
      .set({
        ...data,
        updated_at: databaseNowTimestamp,
      })
      .where(and(eq(users.public_id, public_id), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  async update(
    public_id: string,
    data: { first_name?: string | null; last_name?: string | null; avatar_url?: string | null },
  ) {
    return this.updateByPublicId(public_id, data as Record<string, unknown>);
  }

  /** Create a user from an OAuth profile (no password). */
  async createFromOAuth(data: {
    email: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    is_email_verified: boolean;
  }) {
    const emailHash = createHash('sha256').update(data.email.toLowerCase()).digest('hex');
    return runInsertWithPublicIdentifierRetry(async () => {
      const publicId = generatePublicId();
      const rows = await getRequestDatabase()
        .insert(users)
        .values({
          public_id: publicId,
          email: data.email,
          email_hash: emailHash,
          first_name: data.first_name ?? null,
          last_name: data.last_name ?? null,
          avatar_url: data.avatar_url ?? null,
          is_email_verified: data.is_email_verified,
          status: 'ACTIVE',
        })
        .returning();
      return rows[0]!;
    });
  }

  // ── Admin methods ──────────────────────────────────────────

  async findMany(options: { page: number; limit: number; status?: string; search?: string }) {
    const conditions = [isNull(users.deleted_at)];
    if (options.status) {
      conditions.push(eq(users.status, options.status));
    }
    if (options.search) {
      const pattern = `%${escapeLikePattern(options.search)}%`;
      conditions.push(
        or(
          like(users.email, pattern),
          like(users.first_name, pattern),
          like(users.last_name, pattern),
        )!,
      );
    }

    const offset = (options.page - 1) * options.limit;
    const [rows, totalRows] = await Promise.all([
      getRequestDatabase()
        .select()
        .from(users)
        .where(and(...conditions))
        .limit(options.limit)
        .offset(offset)
        .orderBy(users.created_at),
      getRequestDatabase()
        .select({ count: count() })
        .from(users)
        .where(and(...conditions)),
    ]);

    return {
      items: rows,
      total: totalRows[0]?.count ?? 0,
    };
  }

  async adminUpdate(
    public_id: string,
    data: { first_name?: string | null; last_name?: string | null; status?: string },
  ) {
    return this.updateByPublicId(public_id, data as Record<string, unknown>);
  }

  async suspend(public_id: string) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({ status: 'SUSPENDED', updated_at: databaseNowTimestamp })
      .where(and(eq(users.public_id, public_id), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  async unsuspend(public_id: string) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({ status: 'ACTIVE', updated_at: databaseNowTimestamp })
      .where(and(eq(users.public_id, public_id), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(public_id: string) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(and(eq(users.public_id, public_id), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  async updateLoginAttempt(
    publicId: string,
    failedLoginCount: number,
    accountLockedUntil: Date | null,
  ) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({
        failed_login_count: failedLoginCount,
        account_locked_until: accountLockedUntil,
        updated_at: databaseNowTimestamp,
      })
      .where(and(eq(users.public_id, publicId), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }

  async updateMfaEnabled(publicId: string, enabled: boolean) {
    const rows = await getRequestDatabase()
      .update(users)
      .set({ is_mfa_enabled: enabled, updated_at: databaseNowTimestamp })
      .where(and(eq(users.public_id, publicId), isNull(users.deleted_at)))
      .returning();
    return rows[0] ?? null;
  }
}
