import { and, eq } from 'drizzle-orm';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { resolveRepositoryDatabaseHandle } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import { assertWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database-context.js';
import { user_data_exports } from '@/domains/user/sub-domains/user-data-export/user-data-export.schema.js';
import type { UserDataExportStatus } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';

export type UserDataExportInsert = {
  public_id: string;
  user_id: number;
  status: UserDataExportStatus;
  s3_key: string;
  expires_at: Date;
};

export class UserDataExportRepository {
  constructor(private readonly databaseHandle?: RequestScopedPostgresDatabase) {}

  private db(): RequestScopedPostgresDatabase {
    return resolveRepositoryDatabaseHandle(this.databaseHandle);
  }

  async create(row: UserDataExportInsert) {
    const [created] = await this.db()
      .insert(user_data_exports)
      .values({
        public_id: row.public_id,
        user_id: row.user_id,
        status: row.status,
        s3_key: row.s3_key,
        expires_at: row.expires_at,
      })
      .returning();
    return created!;
  }

  async findByPublicIdAndUserId(export_public_id: string, user_id: number) {
    const rows = await this.db()
      .select()
      .from(user_data_exports)
      .where(
        and(
          eq(user_data_exports.public_id, export_public_id),
          eq(user_data_exports.user_id, user_id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listByUserId(user_id: number) {
    return this.db().select().from(user_data_exports).where(eq(user_data_exports.user_id, user_id));
  }

  async updateStatus(
    export_public_id: string,
    user_id: number,
    patch: {
      status: UserDataExportStatus;
      s3_key?: string | null;
      expires_at?: Date | null;
      completed_at?: Date | null;
      failed_at?: Date | null;
      error_code?: string | null;
    },
  ) {
    const [updated] = await this.db()
      .update(user_data_exports)
      .set({
        status: patch.status,
        ...(patch.s3_key !== undefined ? { s3_key: patch.s3_key } : {}),
        ...(patch.expires_at !== undefined ? { expires_at: patch.expires_at } : {}),
        ...(patch.completed_at !== undefined ? { completed_at: patch.completed_at } : {}),
        ...(patch.failed_at !== undefined ? { failed_at: patch.failed_at } : {}),
        ...(patch.error_code !== undefined ? { error_code: patch.error_code } : {}),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(user_data_exports.public_id, export_public_id),
          eq(user_data_exports.user_id, user_id),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async deleteAllByUserId(user_id: number): Promise<number> {
    const deleted = await this.db()
      .delete(user_data_exports)
      .where(eq(user_data_exports.user_id, user_id))
      .returning({ id: user_data_exports.id });
    return deleted.length;
  }
}

/** Worker-only factory — requires an explicit handle from `withUserDatabaseContext`. */
export function createWorkerUserDataExportRepository(
  databaseHandle: RequestScopedPostgresDatabase,
): UserDataExportRepository {
  assertWorkerDatabaseContext(['user']);
  return new UserDataExportRepository(databaseHandle);
}
