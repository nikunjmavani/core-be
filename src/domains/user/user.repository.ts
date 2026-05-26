import { createHash } from 'node:crypto';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { and, asc, eq, isNull, like, or, count, type SQL } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { users } from '@/domains/user/user.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { escapeLikePattern } from '@/shared/utils/validation/validation.util.js';
import {
  buildAscendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';

export interface UserListPagination {
  after?: string;
  limit: number;
  status?: string;
  search?: string;
  include_total?: boolean;
}

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

  async findMany(pagination: UserListPagination) {
    const { after, limit, status, search } = pagination;
    const includeTotal = pagination.include_total === true;
    const filterConditions: SQL[] = [isNull(users.deleted_at)!];
    if (status) {
      filterConditions.push(eq(users.status, status));
    }
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      filterConditions.push(
        or(
          like(users.email, pattern),
          like(users.first_name, pattern),
          like(users.last_name, pattern),
        )!,
      );
    }
    const countWhere = and(...filterConditions);
    const cursorCondition = buildAscendingCreatedAtIdCursorCondition(
      users.created_at,
      users.id,
      parseListCursor(after),
    );
    const where =
      cursorCondition !== undefined ? and(...filterConditions, cursorCondition) : countWhere;

    // Fetch one extra row so has_more is accurate without depending on count(*).
    const rowsPromise = getRequestDatabase()
      .select()
      .from(users)
      .where(where)
      .orderBy(asc(users.created_at), asc(users.id))
      .limit(limit + 1);

    const countPromise = includeTotal
      ? getRequestDatabase()
          .select({ count: count() })
          .from(users)
          .where(countWhere)
          .then((rows) => rows[0]?.count ?? 0)
      : Promise.resolve(null);

    const [fetchedRows, total] = await Promise.all([rowsPromise, countPromise]);
    const hasMore = fetchedRows.length > limit;
    const items = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    const lastItem = items.at(-1);
    const nextCursor =
      hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null;
    return {
      items,
      total,
      limit,
      has_more: hasMore,
      next_cursor: nextCursor,
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
