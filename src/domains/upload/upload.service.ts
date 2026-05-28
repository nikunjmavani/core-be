import { randomUUID } from 'node:crypto';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { getEnv } from '@/shared/config/env.config.js';
import {
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/index.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { resolveUserOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import {
  UPLOAD_PURPOSE_CONFIG,
  UPLOAD_PURPOSES,
  PRESIGNED_URL_EXPIRY_SECONDS,
  UPLOAD_STATUS,
  UPLOAD_TARGETS,
  buildOrganizationLogoKeyPrefix,
  buildUserAvatarKeyPrefix,
} from './upload.constants.js';
import { getCanonicalExtensionForContentType } from './upload-content-type.util.js';
import { UPLOAD_PERMISSIONS } from './upload.permissions.js';
import type { CreateUploadInput, UploadCreateOutput, UploadDetailOutput } from './upload.types.js';
import type { UploadRepository, UploadRow } from './upload.repository.js';
import { serializeUploadCreate, serializeUploadDetail } from './upload.serializer.js';
import { validateUploadPublicIdParam } from './upload.validator.js';

/**
 * Owns the upload lifecycle behind the public upload routes and the
 * cross-domain offboarding hooks.
 *
 * @remarks
 * - **Algorithm:** {@link UploadService.createUpload} validates the per-user
 *   PENDING quota, resolves owner/organization context, computes the S3 key
 *   from {@link UPLOAD_PURPOSE_CONFIG} + a canonical extension, requests a
 *   presigned URL (PUT or POST per `UPLOAD_USE_PRESIGNED_POST`) from the
 *   storage adapter, and inserts the row inside {@link withUserDatabaseContext}
 *   so the owner-access RLS policy authorizes the write.
 *   {@link UploadService.confirmUpload} HEADs the object, compares
 *   content-type/length against the declared values, and transitions
 *   `PENDING` → `UPLOADED` (idempotent for already-confirmed rows) or
 *   `FAILED` on mismatch. {@link UploadService.deleteUpload} performs a
 *   best-effort S3 delete then soft-deletes the row.
 * - **Failure modes:** quota exceeded → `ValidationError`; missing org
 *   permission → `ForbiddenError`; unknown public id or owner mismatch →
 *   `NotFoundError`; S3 verification failure → row moved to `FAILED` and a
 *   `ValidationError` raised so the caller does not attach an unverified
 *   object; missing `S3_BUCKET` → `ConfigurationError`.
 * - **Side effects:** issues presigned S3 URLs, HEADs/DELETEs S3 objects,
 *   inserts/updates `upload.uploads`, and emits no in-process events.
 *   Storage access is abstracted behind {@link ObjectStoragePort} so tests
 *   can substitute an in-memory adapter.
 * - **Notes:** offboarding hooks
 *   ({@link UploadService.tombstoneAllByUserId} /
 *   {@link UploadService.tombstoneAllByOrganizationId}) only soft-delete rows;
 *   user offboarding additionally attempts per-object S3 deletes, while
 *   organization tombstones defer object removal to the retention worker.
 *   `assertKeyConfirmed` is the gate cross-domain consumers (avatar/logo
 *   attach) call before linking an upload — it never authorizes ownership,
 *   which the caller enforces by key prefix.
 */
export class UploadService {
  constructor(
    private readonly repository: UploadRepository,
    private readonly userService: UserService,
    private readonly organizationService: OrganizationService,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  async createUpload(input: CreateUploadInput, userPublicId: string): Promise<UploadCreateOutput> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    await this.assertPendingUploadQuota(user.id, userPublicId);

    const organizationInternalId = await this.resolveUploadOrganizationInternalId(
      input,
      userPublicId,
    );
    const config = UPLOAD_PURPOSE_CONFIG[input.purpose];
    const extension = getCanonicalExtensionForContentType(input.contentType);
    const ownerSegment =
      input.for === UPLOAD_TARGETS.ORGANIZATION ? input.organizationId! : userPublicId;
    let key: string;
    if (input.purpose === UPLOAD_PURPOSES.AVATAR) {
      key = `${buildUserAvatarKeyPrefix(userPublicId)}${randomUUID()}${extension}`;
    } else if (input.purpose === UPLOAD_PURPOSES.ORGANIZATION_LOGO) {
      key = `${buildOrganizationLogoKeyPrefix(input.organizationId!)}${randomUUID()}${extension}`;
    } else {
      key = `${config.keyPrefix}/${ownerSegment}/${randomUUID()}${extension}`;
    }

    const environment = getEnv();
    const bucket = environment.S3_BUCKET;
    if (!bucket) {
      throw new ConfigurationError('S3_BUCKET is not configured');
    }

    let uploadUrl: string;
    let uploadMethod: 'PUT' | 'POST';
    let fields: Record<string, string> | undefined;

    if (environment.UPLOAD_USE_PRESIGNED_POST) {
      // S3 enforces the content-length-range at upload time, rejecting empty/oversized bodies.
      const post = await this.objectStorage.createPresignedUploadPost({
        key,
        contentType: input.contentType,
        minContentLength: 1,
        maxContentLength: config.maxSize,
        expiresInSeconds: PRESIGNED_URL_EXPIRY_SECONDS,
        metadata: {
          purpose: input.purpose,
          'declared-type': input.contentType,
          owner: userPublicId,
        },
      });
      uploadUrl = post.url;
      fields = post.fields;
      uploadMethod = 'POST';
    } else {
      uploadUrl = await this.objectStorage.createPresignedUploadUrl({
        key,
        contentType: input.contentType,
        contentLength: input.fileSize,
        expiresInSeconds: PRESIGNED_URL_EXPIRY_SECONDS,
      });
      uploadMethod = 'PUT';
    }

    const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000);

    // Presigned URL generation (S3) is done above, outside the DB context; only the insert
    // runs in the user-scoped context so the owner RLS policy authorizes the row.
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.repository.create({
        user_id: user.id,
        organization_id: organizationInternalId,
        file_name: input.fileName,
        file_key: key,
        mime_type: input.contentType,
        file_size: input.fileSize,
        storage_provider: 's3',
        bucket,
        status: 'PENDING',
        created_by_user_id: user.id,
      }),
    );

    return serializeUploadCreate({
      publicId: row.public_id,
      uploadUrl,
      key,
      expiresAt,
      uploadMethod,
      ...(fields !== undefined ? { fields } : {}),
    });
  }

  private async assertPendingUploadQuota(
    userInternalId: number,
    userPublicId: string,
  ): Promise<void> {
    // Enforce a per-user cap on in-flight PENDING uploads. Stops a single authed user from
    // exhausting storage by repeatedly requesting presigned URLs without ever calling confirm.
    // The PENDING sweeper eventually reconciles the rows, but the cap is the immediate guard.
    const pendingCap = getEnv().UPLOAD_MAX_PENDING_PER_USER;
    const pendingCount = await withUserDatabaseContext(userPublicId, () =>
      this.repository.countPendingByUserId(userInternalId),
    );
    if (pendingCount >= pendingCap) {
      throw new ValidationError(
        'errors:uploadPendingQuotaExceeded',
        { limit: pendingCap, pending: pendingCount },
        undefined,
        [
          {
            field: 'fileSize',
            messageKey: 'errors:uploadPendingQuotaExceeded',
            messageParams: { limit: pendingCap, pending: pendingCount },
          },
        ],
      );
    }
  }

  private async resolveUploadOrganizationInternalId(
    input: CreateUploadInput,
    userPublicId: string,
  ): Promise<number | null> {
    if (input.for === UPLOAD_TARGETS.ORGANIZATION && input.organizationId) {
      const permissions = await resolveUserOrganizationPermissions(
        userPublicId,
        input.organizationId,
      );
      if (!permissions.includes(UPLOAD_PERMISSIONS.UPLOAD_MANAGE)) {
        throw new ForbiddenError('errors:insufficientUploadPermissions');
      }
      /**
       * `requireOrganizationByPublicId` reads `tenancy.organizations` which is FORCE RLS.
       * Under `DATABASE_RLS_SCOPED_CONTEXTS=true` the call needs either an active
       * organization context or `app.current_user_id` + the `organizations_user_discovery`
       * policy. The latter is appropriate here because we have just authorized the user.
       */
      const organization = await withUserDatabaseContext(userPublicId, () =>
        this.organizationService.requireOrganizationByPublicId(input.organizationId!),
      );
      return organization.id;
    }
    return null;
  }

  /**
   * Gate for cross-domain consumers (avatar/logo attach): the upload row for this storage key
   * must exist and be in UPLOADED status — i.e. it went through confirmUpload. Ownership is
   * enforced by the caller via the key prefix, so this only asserts the finalization state.
   */
  async assertKeyConfirmed(fileKey: string): Promise<void> {
    const row = await this.repository.findByFileKey(fileKey);
    if (!row) {
      throw new ValidationError('errors:validation.uploadNotConfirmed', undefined, {
        key: ['No upload exists for this key'],
      });
    }
    if (row.status !== UPLOAD_STATUS.UPLOADED) {
      throw new ValidationError('errors:validation.uploadNotConfirmed', undefined, {
        key: ['Upload has not been confirmed'],
      });
    }
  }

  async getUpload(public_id: string, userPublicId: string): Promise<UploadDetailOutput> {
    const validatedPublicId = validateUploadPublicIdParam(public_id);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.repository.findByPublicIdForUser(validatedPublicId, user.id),
    );
    if (!row) throw new NotFoundError('Upload');

    return this.toUploadDetail(row, userPublicId);
  }

  /**
   * Server-side finalization: HEAD the uploaded object and compare its content type/length
   * against the values declared at create time. On success the row moves PENDING → UPLOADED;
   * on mismatch/missing it moves to FAILED and a validation error is surfaced. Consumers must
   * require UPLOADED before attaching the object. Idempotent for already-UPLOADED rows.
   */
  async confirmUpload(public_id: string, userPublicId: string): Promise<UploadDetailOutput> {
    const validatedPublicId = validateUploadPublicIdParam(public_id);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.repository.findByPublicIdForUser(validatedPublicId, user.id),
    );
    if (!row) throw new NotFoundError('Upload');

    if (row.status === UPLOAD_STATUS.UPLOADED) {
      return this.toUploadDetail(row, userPublicId);
    }
    if (row.status !== UPLOAD_STATUS.PENDING) {
      throw new ValidationError('errors:uploadNotPending', undefined, {
        status: ['Upload is not awaiting confirmation'],
      });
    }

    let verified = false;
    try {
      const metadata = await this.objectStorage.verifyUploadedObject(row.file_key, {
        contentType: row.mime_type,
        contentLength: row.file_size,
      });
      const objectExists = metadata.contentLength !== undefined;
      const lengthMatches = metadata.contentLength === row.file_size;
      // S3 may not echo a content type; only fail on type when one is reported.
      const typeMatches =
        metadata.contentType === undefined || metadata.contentType === row.mime_type;
      verified = objectExists && lengthMatches && typeMatches;
    } catch (error) {
      logger.warn(
        { publicId: validatedPublicId, fileKey: row.file_key, error },
        'upload.confirm.verifyFailed',
      );
      verified = false;
    }

    const updated = await withUserDatabaseContext(userPublicId, () =>
      this.repository.markStatus(
        validatedPublicId,
        user.id,
        verified ? UPLOAD_STATUS.UPLOADED : UPLOAD_STATUS.FAILED,
      ),
    );
    if (!updated) throw new NotFoundError('Upload');

    if (!verified) {
      throw new ValidationError('errors:uploadVerificationFailed', undefined, {
        file: ['Uploaded object could not be verified against its declared type and size'],
      });
    }

    return this.toUploadDetail(updated, userPublicId);
  }

  private async toUploadDetail(row: UploadRow, userPublicId?: string): Promise<UploadDetailOutput> {
    let organizationPublicId: string | null = null;
    if (row.organization_id !== null) {
      /**
       * `findOrganizationByInternalId` hits `tenancy.organizations` (FORCE RLS). When
       * we have a user public id, wrap so the `organizations_user_discovery` policy
       * is satisfied; otherwise fall back to the bare call (works under legacy mode
       * and for callers that already pin an organization context).
       */
      const organization =
        userPublicId !== undefined && userPublicId.length > 0
          ? await withUserDatabaseContext(userPublicId, () =>
              this.organizationService.findOrganizationByInternalId(row.organization_id!),
            )
          : await this.organizationService.findOrganizationByInternalId(row.organization_id);
      organizationPublicId = organization?.public_id ?? null;
    }
    return serializeUploadDetail(row, organizationPublicId);
  }

  async deleteUpload(public_id: string, userPublicId: string): Promise<void> {
    const validatedPublicId = validateUploadPublicIdParam(public_id);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.repository.findByPublicIdForUser(validatedPublicId, user.id),
    );
    if (!row) throw new NotFoundError('Upload');

    // S3 delete runs outside the DB context.
    const objectDeleted = await this.objectStorage.deleteObject(row.file_key);
    if (!objectDeleted) {
      logger.warn(
        { publicId: validatedPublicId, fileKey: row.file_key },
        'upload.delete.s3ObjectDeleteFailed',
      );
    }

    const deleted = await withUserDatabaseContext(userPublicId, () =>
      this.repository.softDelete(validatedPublicId, user.id),
    );
    if (!deleted) throw new NotFoundError('Upload');
  }

  /** Tombstones all active uploads for a user (offboarding) and removes S3 objects when possible. */
  async tombstoneAllByUserId(user_id: number): Promise<number> {
    const rows = await this.repository.findActiveByUserId(user_id);
    for (const row of rows) {
      const objectDeleted = await this.objectStorage.deleteObject(row.file_key);
      if (!objectDeleted) {
        logger.warn(
          { userId: user_id, fileKey: row.file_key },
          'upload.offboarding.s3ObjectDeleteFailed',
        );
      }
    }
    return this.repository.softDeleteAllByUserId(user_id);
  }

  /** Tombstones org-scoped uploads (DB only; S3 removed on retention purge or per-upload DELETE). */
  async tombstoneAllByOrganizationId(organization_id: number): Promise<number> {
    return this.repository.softDeleteAllByOrganizationId(organization_id);
  }
}
