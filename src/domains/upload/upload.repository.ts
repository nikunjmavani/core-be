import { and, eq, isNull } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';

export type UploadRow = typeof uploads.$inferSelect;

export interface UploadCreateData {
  user_id: number;
  organization_id?: number | null;
  file_name: string;
  file_key: string;
  mime_type: string;
  file_size: number;
  storage_provider: string;
  bucket: string;
  status?: string;
  created_by_user_id?: number;
}

export class UploadRepository {
  async create(data: UploadCreateData): Promise<UploadRow> {
    return runInsertWithPublicIdentifierRetry(async () => {
      const public_id = generatePublicId();
      const rows = await getRequestDatabase()
        .insert(uploads)
        .values({
          public_id,
          user_id: data.user_id,
          organization_id: data.organization_id ?? null,
          file_name: data.file_name,
          file_key: data.file_key,
          mime_type: data.mime_type,
          file_size: data.file_size,
          storage_provider: data.storage_provider,
          bucket: data.bucket,
          status: data.status ?? 'PENDING',
          created_by_user_id: data.created_by_user_id ?? data.user_id,
        })
        .returning();
      return rows[0]!;
    });
  }

  async findByPublicId(public_id: string): Promise<UploadRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(uploads)
      .where(and(eq(uploads.public_id, public_id), isNull(uploads.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPublicIdForUser(public_id: string, user_id: number): Promise<UploadRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(uploads)
      .where(
        and(
          eq(uploads.public_id, public_id),
          eq(uploads.user_id, user_id),
          isNull(uploads.deleted_at),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async softDelete(public_id: string, user_id: number): Promise<UploadRow | null> {
    const rows = await getRequestDatabase()
      .update(uploads)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(uploads.public_id, public_id),
          eq(uploads.user_id, user_id),
          isNull(uploads.deleted_at),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async findActiveByUserId(user_id: number): Promise<Pick<UploadRow, 'id' | 'file_key'>[]> {
    return getRequestDatabase()
      .select({ id: uploads.id, file_key: uploads.file_key })
      .from(uploads)
      .where(and(eq(uploads.user_id, user_id), isNull(uploads.deleted_at)));
  }

  async findActiveByOrganizationId(
    organization_id: number,
  ): Promise<Pick<UploadRow, 'id' | 'file_key'>[]> {
    return getRequestDatabase()
      .select({ id: uploads.id, file_key: uploads.file_key })
      .from(uploads)
      .where(and(eq(uploads.organization_id, organization_id), isNull(uploads.deleted_at)));
  }

  async softDeleteAllByUserId(user_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .update(uploads)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(and(eq(uploads.user_id, user_id), isNull(uploads.deleted_at)))
      .returning({ id: uploads.id });
    return rows.length;
  }

  async softDeleteAllByOrganizationId(organization_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .update(uploads)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(and(eq(uploads.organization_id, organization_id), isNull(uploads.deleted_at)))
      .returning({ id: uploads.id });
    return rows.length;
  }
}
