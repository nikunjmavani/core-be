import { ConfigurationError, NotFoundError } from '@/shared/errors/index.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { createWorkerUserDataExportRepository } from '@/domains/user/sub-domains/user-data-export/user-data-export.repository.js';
import { users } from '@/domains/user/user.schema.js';
import { sessions } from '@/domains/auth/sub-domains/auth-session/auth-session.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { notifications } from '@/domains/notify/sub-domains/notification/notification.schema.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { GDPR_EXPORT_MAX_ROWS_PER_TABLE } from '@/shared/constants/query-limits.constants.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { UserDataExportRepository } from '@/domains/user/sub-domains/user-data-export/user-data-export.repository.js';
import { serializeUserDataExport } from '@/domains/user/sub-domains/user-data-export/user-data-export.serializer.js';
import {
  USER_DATA_EXPORT_ARTIFACT_TTL_DAYS,
  USER_DATA_EXPORT_S3_PREFIX,
} from '@/domains/user/sub-domains/user-data-export/user-data-export.constants.js';
import {
  USER_DATA_EXPORT_STATUSES,
  UserDataExportCancelledError,
  type UserDataExportOutput,
} from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';
import type { UserDataExport } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';
import { eventBus } from '@/core/events/event-bus.js';
import { enqueueUserDataExport } from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.queue.js';
import { USER_DATA_EXPORT_PRESIGNED_DOWNLOAD_EXPIRY_SECONDS } from '@/shared/constants/ttl.constants.js';
import { env } from '@/shared/config/env.config.js';

function buildExportS3Key(userPublicId: string, exportPublicId: string): string {
  return `${USER_DATA_EXPORT_S3_PREFIX}/${userPublicId}/${exportPublicId}.json.gz`;
}

function computeArtifactExpiresAt(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + USER_DATA_EXPORT_ARTIFACT_TTL_DAYS);
  return expiresAt;
}

/**
 * Orchestrates the GDPR "right to data portability" export pipeline end-to-end.
 *
 * @remarks
 * - **Algorithm:** request → persist a `pending` row → enqueue BullMQ job on commit; worker calls
 *   {@link UserDataExportService.markProcessing}, then {@link UserDataExportService.buildExportPayload}
 *   to aggregate cross-domain rows (users, memberships+orgs, sessions, notifications, audit logs)
 *   under {@link GDPR_EXPORT_MAX_ROWS_PER_TABLE}, gzips the JSON, uploads to S3, and flips status to
 *   `completed`. On status reads, a presigned download URL is minted only when COMPLETED and
 *   `expires_at` is in the future.
 * - **Failure modes:** missing user → {@link NotFoundError}; missing S3 bucket config →
 *   {@link ConfigurationError}; concurrent user soft-delete or row removal → throws
 *   {@link UserDataExportCancelledError} so the worker exits without retry; unexpected errors are
 *   recorded via {@link UserDataExportService.failExportJob}.
 * - **Side effects:** writes `auth.user_data_exports`, uploads/deletes objects in the GDPR S3
 *   prefix, enqueues `user-data-export` BullMQ jobs, and emits info-level audit logs. Used by
 *   `UserService` offboarding to purge every export row + S3 object on account deletion.
 * - **Notes:** documented cross-domain schema-read exception — this service reads `users`,
 *   `sessions`, `memberships`, `organizations`, `notifications`, and `logs` directly via the worker
 *   database handle (forbidden elsewhere; see CLAUDE.md "Dependency Rules"). Self-service only — no
 *   organization context required.
 */
export class UserDataExportService {
  constructor(
    private readonly userService: UserService,
    private readonly exportRepository: UserDataExportRepository,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  async requestExport(userPublicId: string): Promise<UserDataExportOutput> {
    const user = await this.userService.findUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');

    const existingPending = await withUserDatabaseContext(userPublicId, () =>
      this.exportRepository.findPendingOrProcessingByUserId(user.id),
    );
    if (existingPending) {
      logger.info(
        { userPublicId, exportPublicId: existingPending.public_id },
        'user-data-export.existing_pending_returned',
      );
      return serializeUserDataExport(existingPending);
    }

    const exportPublicId = generatePublicId();
    const s3Key = buildExportS3Key(userPublicId, exportPublicId);
    const expiresAt = computeArtifactExpiresAt();

    // auth.user_data_exports is FORCE RLS keyed on app.current_user_id — insert inside the user
    // context so the row passes the owner-access policy in default scoped-RLS mode.
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.exportRepository.create({
        public_id: exportPublicId,
        user_id: user.id,
        status: USER_DATA_EXPORT_STATUSES.PENDING,
        s3_key: s3Key,
        expires_at: expiresAt,
      }),
    );

    eventBus.onCommit(async () => {
      try {
        await enqueueUserDataExport({
          exportPublicId,
          userPublicId,
          userInternalId: user.id,
        });
      } catch (error) {
        logger.error({ error, userPublicId, exportPublicId }, 'user-data-export.enqueue.failed');
        await withUserDatabaseContext(userPublicId, () =>
          this.exportRepository.updateStatus(exportPublicId, user.id, {
            status: USER_DATA_EXPORT_STATUSES.FAILED,
            failed_at: new Date(),
            error_code: 'enqueue_failed',
          }),
        );
      }
    });

    logger.info({ userPublicId, exportPublicId }, 'user-data-export.requested');

    return serializeUserDataExport(row);
  }

  async getExportStatus(
    userPublicId: string,
    exportPublicId: string,
  ): Promise<UserDataExportOutput> {
    const user = await this.userService.findUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');

    const row = await withUserDatabaseContext(userPublicId, () =>
      this.exportRepository.findByPublicIdAndUserId(exportPublicId, user.id),
    );
    if (!row) throw new NotFoundError('User data export');

    let downloadUrl: string | null = null;
    if (
      row.status === USER_DATA_EXPORT_STATUSES.COMPLETED &&
      row.s3_key &&
      row.expires_at &&
      row.expires_at.getTime() > Date.now()
    ) {
      if (!env.S3_BUCKET) {
        throw new ConfigurationError('S3_BUCKET is not configured');
      }
      downloadUrl = await this.objectStorage.createPresignedDownloadUrl({
        key: row.s3_key,
        expiresInSeconds: USER_DATA_EXPORT_PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
      });
    }

    return serializeUserDataExport(row, { download_url: downloadUrl });
  }

  /**
   * Returns false when the export row was removed (offboarding) or the user was soft-deleted.
   * Worker jobs should exit without retry when this returns false.
   */
  async isExportJobCancelled(
    exportPublicId: string,
    userInternalId: number,
    databaseHandle: RequestScopedPostgresDatabase,
  ): Promise<boolean> {
    const exportRepository = createWorkerUserDataExportRepository(databaseHandle);
    const row = await exportRepository.findByPublicIdAndUserId(exportPublicId, userInternalId);
    if (!row) {
      return true;
    }

    const userRows = await databaseHandle
      .select({ deleted_at: users.deleted_at })
      .from(users)
      .where(eq(users.id, userInternalId))
      .limit(1);
    const user = userRows[0];
    return user === undefined || user.deleted_at !== null;
  }

  async markProcessing(
    exportPublicId: string,
    userInternalId: number,
    databaseHandle?: RequestScopedPostgresDatabase,
  ): Promise<void> {
    const exportRepository = this.resolveExportRepository(databaseHandle);
    if (databaseHandle !== undefined) {
      const cancelled = await this.isExportJobCancelled(
        exportPublicId,
        userInternalId,
        databaseHandle,
      );
      if (cancelled) {
        throw new UserDataExportCancelledError();
      }
    }
    const updated = await exportRepository.updateStatus(exportPublicId, userInternalId, {
      status: USER_DATA_EXPORT_STATUSES.PROCESSING,
    });
    if (!updated) {
      throw new UserDataExportCancelledError();
    }
  }

  async completeExportJob(
    options: {
      exportPublicId: string;
      userInternalId: number;
      body: Buffer;
    },
    databaseHandle?: RequestScopedPostgresDatabase,
  ): Promise<void> {
    const exportRepository = this.resolveExportRepository(databaseHandle);
    if (databaseHandle !== undefined) {
      const cancelled = await this.isExportJobCancelled(
        options.exportPublicId,
        options.userInternalId,
        databaseHandle,
      );
      if (cancelled) {
        throw new UserDataExportCancelledError();
      }
    }

    const row = await exportRepository.findByPublicIdAndUserId(
      options.exportPublicId,
      options.userInternalId,
    );
    if (!row?.s3_key) {
      throw new UserDataExportCancelledError();
    }

    await this.objectStorage.putObject({
      key: row.s3_key,
      body: options.body,
      contentType: 'application/gzip',
      metadata: {
        format: 'json',
        schema_version: '1',
      },
    });

    const completedAt = new Date();
    await exportRepository.updateStatus(options.exportPublicId, options.userInternalId, {
      status: USER_DATA_EXPORT_STATUSES.COMPLETED,
      completed_at: completedAt,
      failed_at: null,
      error_code: null,
    });
  }

  async failExportJob(
    exportPublicId: string,
    userInternalId: number,
    errorCode: string,
    databaseHandle?: RequestScopedPostgresDatabase,
  ): Promise<void> {
    const exportRepository = this.resolveExportRepository(databaseHandle);
    await exportRepository.updateStatus(exportPublicId, userInternalId, {
      status: USER_DATA_EXPORT_STATUSES.FAILED,
      failed_at: new Date(),
      error_code: errorCode,
    });
  }

  async deleteAllExportsForUser(userInternalId: number, userPublicId: string): Promise<void> {
    // auth.user_data_exports is FORCE RLS keyed on app.current_user_id. Offboarding can be initiated
    // by an admin, so pin the context to the TARGET user (not the caller) so the owner-access policy
    // matches and the rows are actually removed in default scoped-RLS mode.
    const rows = await withUserDatabaseContext(userPublicId, () =>
      this.exportRepository.listByUserId(userInternalId),
    );
    for (const row of rows) {
      if (row.s3_key) {
        const objectDeleted = await this.objectStorage.deleteObject(row.s3_key);
        if (!objectDeleted) {
          logger.warn(
            { userInternalId, exportPublicId: row.public_id, s3Key: row.s3_key },
            'user-data-export.offboarding.s3DeleteFailed',
          );
        }
      }
    }
    const deletedCount = await withUserDatabaseContext(userPublicId, () =>
      this.exportRepository.deleteAllByUserId(userInternalId),
    );
    if (deletedCount > 0) {
      logger.info({ userInternalId, deletedCount }, 'user-data-export.offboarding.deleted');
    }
  }

  private resolveExportRepository(
    databaseHandle?: RequestScopedPostgresDatabase,
  ): UserDataExportRepository {
    return databaseHandle !== undefined
      ? createWorkerUserDataExportRepository(databaseHandle)
      : this.exportRepository;
  }

  async buildExportPayload(
    userPublicId: string,
    databaseHandle: RequestScopedPostgresDatabase,
  ): Promise<UserDataExport> {
    const userRows = await databaseHandle
      .select()
      .from(users)
      .where(and(eq(users.public_id, userPublicId), isNull(users.deleted_at)))
      .limit(1);
    const user = userRows[0];
    if (!user) throw new NotFoundError('User');

    const [userMemberships, userSessions, userNotifications, userAuditLogs] = await Promise.all([
      databaseHandle
        .select({
          name: organizations.name,
          slug: organizations.slug,
          status: memberships.status,
          created_at: memberships.created_at,
        })
        .from(memberships)
        .innerJoin(organizations, eq(memberships.organization_id, organizations.id))
        .where(
          and(
            eq(memberships.user_id, user.id),
            isNull(memberships.deleted_at),
            isNull(organizations.deleted_at),
          ),
        )
        .limit(GDPR_EXPORT_MAX_ROWS_PER_TABLE),

      databaseHandle
        .select({
          ip_address: sessions.ip_address,
          last_active_at: sessions.last_active_at,
          created_at: sessions.created_at,
        })
        .from(sessions)
        .where(eq(sessions.user_id, user.id))
        .orderBy(desc(sessions.created_at))
        .limit(GDPR_EXPORT_MAX_ROWS_PER_TABLE),

      databaseHandle
        .select({
          type: notifications.type,
          title: notifications.title,
          message: notifications.message,
          created_at: notifications.created_at,
        })
        .from(notifications)
        .where(eq(notifications.user_id, user.id))
        .orderBy(desc(notifications.created_at))
        .limit(GDPR_EXPORT_MAX_ROWS_PER_TABLE),

      databaseHandle
        .select({
          action: logs.action,
          resource_type: logs.resource_type,
          created_at: logs.created_at,
        })
        .from(logs)
        .where(eq(logs.actor_user_id, user.id))
        .orderBy(desc(logs.created_at))
        .limit(GDPR_EXPORT_MAX_ROWS_PER_TABLE),
    ]);

    return {
      user: {
        id: user.public_id,
        email: user.email,
        full_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
        created_at: user.created_at.toISOString(),
      },
      organizations: userMemberships.map((membership) => ({
        name: membership.name,
        slug: membership.slug,
        role: membership.status,
        joined_at: membership.created_at.toISOString(),
      })),
      sessions: userSessions.map((session) => ({
        ip_address: session.ip_address,
        last_active_at: session.last_active_at.toISOString(),
        created_at: session.created_at.toISOString(),
      })),
      notifications: userNotifications.map((notification) => ({
        type: notification.type,
        title: notification.title,
        message: notification.message,
        created_at: notification.created_at.toISOString(),
      })),
      audit_activity: userAuditLogs.map((log) => ({
        action: log.action,
        resource_type: log.resource_type,
        created_at: log.created_at.toISOString(),
      })),
      exported_at: new Date().toISOString(),
    };
  }
}
