import { and, asc, count, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';

export type UploadRow = typeof uploads.$inferSelect;

/** Subset returned to the PENDING sweeper; avoids hauling unused metadata columns. */
export type PendingUploadSweepRow = Pick<
  UploadRow,
  'id' | 'public_id' | 'user_id' | 'file_key' | 'mime_type' | 'file_size' | 'created_at'
>;

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

  async findByFileKey(file_key: string): Promise<UploadRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(uploads)
      .where(and(eq(uploads.file_key, file_key), isNull(uploads.deleted_at)))
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

  async markStatus(public_id: string, user_id: number, status: string): Promise<UploadRow | null> {
    const rows = await getRequestDatabase()
      .update(uploads)
      .set({ status, updated_at: databaseNowTimestamp })
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

  /** Number of in-flight PENDING uploads for a user (active, not soft-deleted). */
  async countPendingByUserId(user_id: number): Promise<number> {
    const rows = await getRequestDatabase()
      .select({ value: count() })
      .from(uploads)
      .where(
        and(
          eq(uploads.user_id, user_id),
          eq(uploads.status, 'PENDING'),
          isNull(uploads.deleted_at),
        ),
      );
    return rows[0]?.value ?? 0;
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

// ─────────────────────────────────────────────────────────────────────────────
// Worker-scoped helpers (sweeper / retention jobs)
//
// These accept an explicit WorkerDatabaseHandle obtained from the retention or
// user database context wrappers. They are NOT for HTTP code paths and must
// not call getRequestDatabase().
// ─────────────────────────────────────────────────────────────────────────────

/** Returns active PENDING uploads created before `cutoff`, oldest first. */
export async function findPendingUploadsOlderThan(
  databaseHandle: WorkerDatabaseHandle,
  cutoff: Date,
  limit: number,
): Promise<PendingUploadSweepRow[]> {
  return databaseHandle
    .select({
      id: uploads.id,
      public_id: uploads.public_id,
      user_id: uploads.user_id,
      file_key: uploads.file_key,
      mime_type: uploads.mime_type,
      file_size: uploads.file_size,
      created_at: uploads.created_at,
    })
    .from(uploads)
    .where(
      and(
        eq(uploads.status, 'PENDING'),
        isNull(uploads.deleted_at),
        lt(uploads.created_at, cutoff),
      ),
    )
    .orderBy(asc(uploads.created_at))
    .limit(limit);
}

/** Updates `status` for an upload by internal id, regardless of owner (worker-scoped). */
export async function setUploadStatusByInternalId(
  databaseHandle: WorkerDatabaseHandle,
  id: number,
  status: string,
): Promise<void> {
  await databaseHandle
    .update(uploads)
    .set({ status, updated_at: databaseNowTimestamp })
    .where(eq(uploads.id, id));
}

/** Hard-deletes upload rows by internal id (caller must remove S3 objects first when needed). */
export async function hardDeleteUploadsByInternalIds(
  databaseHandle: WorkerDatabaseHandle,
  ids: readonly number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await databaseHandle
    .delete(uploads)
    .where(inArray(uploads.id, ids))
    .returning({ id: uploads.id });
  return rows.length;
}
