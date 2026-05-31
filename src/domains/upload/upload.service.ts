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
  UPLOAD_OFFBOARDING_DELETE_BATCH_SIZE,
  UPLOAD_OFFBOARDING_DELETE_CONCURRENCY,
  UPLOAD_STATUS,
  UPLOAD_TARGETS,
  buildOrganizationLogoKeyPrefix,
  buildUserAvatarKeyPrefix,
} from './upload.constants.js';
import { getCanonicalExtensionForContentType } from './upload-content-type.util.js';
import { isSvgContentType, sanitizeSvgBuffer } from './upload-svg.util.js';
import {
  isMagicByteVerifiable,
  verifyFileMagicBytes,
} from '@/shared/utils/validation/file-magic.util.js';
import { UPLOAD_PERMISSIONS } from './upload.permissions.js';
import type { CreateUploadInput, UploadCreateOutput, UploadDetailOutput } from './upload.types.js';
import type { UploadRepository, UploadRow } from './upload.repository.js';
import { serializeUploadCreate, serializeUploadDetail } from './upload.serializer.js';
import { validateUploadPublicIdParam } from './upload.validator.js';

/** Inputs for {@link UploadService}'s private atomic PENDING-slot reservation. */
interface ReservePendingUploadSlotParams {
  userInternalId: number;
  userPublicId: string;
  organizationInternalId: number | null;
  fileName: string;
  fileKey: string;
  contentType: string;
  fileSize: number;
  bucket: string;
}

/**
 * Owns the upload lifecycle behind the public upload routes and the
 * cross-domain offboarding hooks.
 *
 * @remarks
 * - **Algorithm:** {@link UploadService.createUpload} resolves owner/organization
 *   context, computes the S3 key from {@link UPLOAD_PURPOSE_CONFIG} + a canonical
 *   extension, then atomically reserves the PENDING row inside
 *   {@link withUserDatabaseContext} (a per-user advisory lock guards the
 *   pending-count check + insert in one transaction so the quota holds under
 *   concurrency and the owner-access RLS policy authorizes the write) and only
 *   AFTER the slot is committed requests a presigned URL (PUT or POST per
 *   `UPLOAD_USE_PRESIGNED_POST`) from the storage adapter — concurrent callers
 *   can never mint presigned slots beyond the quota.
 *   {@link UploadService.confirmUpload} HEADs the object, compares
 *   content-type/length against the declared values, and transitions
 *   `PENDING` → `UPLOADED` (idempotent for already-confirmed rows) or
 *   `FAILED` on mismatch. {@link UploadService.deleteUpload} performs a
 *   best-effort S3 delete then soft-deletes the row.
 * - **Failure modes:** quota exceeded → `ValidationError`; missing org
 *   permission → `ForbiddenError`; unknown public id or owner mismatch →
 *   `NotFoundError`; S3 verification failure → row moved to `FAILED` and a
 *   `ValidationError` raised so the caller does not attach an unverified
 *   object; missing `S3_BUCKET` → `ConfigurationError`. A presign failure that
 *   occurs AFTER a slot is reserved propagates to the caller and leaves the
 *   PENDING row in place; it is never confirmed, so the pending-sweep worker
 *   reclaims it once it ages past the sweep cutoff.
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

    // Reserve the PENDING row BEFORE presigning so the per-user quota is enforced atomically
    // against concurrent requests (advisory lock + count + insert in one transaction). The
    // presigned URL is minted only after a slot is committed — concurrent callers can never
    // over-provision presigned slots beyond the quota.
    const row = await this.reservePendingUploadSlot({
      userInternalId: user.id,
      userPublicId,
      organizationInternalId,
      fileName: input.fileName,
      fileKey: key,
      contentType: input.contentType,
      fileSize: input.fileSize,
      bucket,
    });

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

    return serializeUploadCreate({
      publicId: row.public_id,
      uploadUrl,
      key,
      expiresAt,
      uploadMethod,
      ...(fields !== undefined ? { fields } : {}),
    });
  }

  /**
   * Atomically reserves a PENDING upload row while enforcing the per-user quota.
   *
   * Runs the advisory lock, pending-count check, and insert inside a single
   * `withUserDatabaseContext` transaction so concurrent create-upload requests are
   * serialized per user: a request can only insert when the committed pending count is
   * still below the cap. The advisory lock releases at COMMIT, after which the next waiter
   * sees the freshly committed row. Stops storage/bandwidth cost abuse from a flood of
   * presign requests that previously all passed a non-atomic count and then over-inserted.
   */
  private async reservePendingUploadSlot(
    params: ReservePendingUploadSlotParams,
  ): Promise<UploadRow> {
    const {
      userInternalId,
      userPublicId,
      organizationInternalId,
      fileName,
      fileKey,
      contentType,
      fileSize,
      bucket,
    } = params;
    const pendingCap = getEnv().UPLOAD_MAX_PENDING_PER_USER;
    return withUserDatabaseContext(userPublicId, async () => {
      await this.repository.acquirePendingUploadQuotaLock(userInternalId);
      const pendingCount = await this.repository.countPendingByUserId(userInternalId);
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
      return this.repository.create({
        user_id: userInternalId,
        organization_id: organizationInternalId,
        file_name: fileName,
        file_key: fileKey,
        mime_type: contentType,
        file_size: fileSize,
        storage_provider: 's3',
        bucket,
        status: 'PENDING',
        created_by_user_id: userInternalId,
      });
    });
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

  private async assertUserCanAccessOrgScopedUpload(
    row: UploadRow,
    userPublicId: string,
  ): Promise<void> {
    if (row.organization_id === null) {
      return;
    }

    const organization = await withUserDatabaseContext(userPublicId, () =>
      this.organizationService.findOrganizationByInternalId(row.organization_id!),
    );
    if (!organization) {
      throw new NotFoundError('Upload');
    }

    const permissions = await resolveUserOrganizationPermissions(
      userPublicId,
      organization.public_id,
    );
    if (!permissions.includes(UPLOAD_PERMISSIONS.UPLOAD_MANAGE)) {
      throw new ForbiddenError('errors:insufficientUploadPermissions');
    }
  }

  async getUpload(public_id: string, userPublicId: string): Promise<UploadDetailOutput> {
    const validatedPublicId = validateUploadPublicIdParam(public_id);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.repository.findByPublicIdForUser(validatedPublicId, user.id),
    );
    if (!row) throw new NotFoundError('Upload');

    await this.assertUserCanAccessOrgScopedUpload(row, userPublicId);

    return this.toUploadDetail(row, userPublicId);
  }

  /**
   * Server-side finalization: HEAD the uploaded object and compare its content type/length
   * against the values declared at create time. On success the row moves PENDING → UPLOADED;
   * on mismatch/missing it moves to FAILED and a validation error is surfaced. SVG objects are
   * sanitized in place (scripts/event handlers stripped) before being marked UPLOADED so the
   * served bytes can never execute as stored XSS. Consumers must require UPLOADED before
   * attaching the object. Idempotent for already-UPLOADED rows.
   */
  async confirmUpload(public_id: string, userPublicId: string): Promise<UploadDetailOutput> {
    const validatedPublicId = validateUploadPublicIdParam(public_id);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    const row = await withUserDatabaseContext(userPublicId, () =>
      this.repository.findByPublicIdForUser(validatedPublicId, user.id),
    );
    if (!row) throw new NotFoundError('Upload');

    await this.assertUserCanAccessOrgScopedUpload(row, userPublicId);

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
      // SVGs are active content: an uploaded <svg onload=…> served from S3/CDN with an
      // image/svg+xml type executes as stored XSS. Neutralise the bytes in place before the
      // object is ever marked UPLOADED (and therefore servable). Hostile/empty SVGs throw and
      // fail verification below.
      if (verified && isSvgContentType(row.mime_type)) {
        await this.sanitizeStoredSvg(row.file_key, row.mime_type);
      } else if (verified && isMagicByteVerifiable(row.mime_type)) {
        // HEAD only echoes the client-declared content-type, which is trivially spoofable
        // (e.g. an HTML/script payload uploaded as image/png). Verify the actual leading
        // bytes match the declared type before the object becomes servable.
        verified = await this.verifyStoredObjectMagicBytes(row.file_key, row.mime_type);
      }
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

  /**
   * Fetches a stored SVG object, strips XSS vectors (scripts, event handlers, hostile filters)
   * via {@link sanitizeSvgBuffer}, and re-writes the sanitized bytes to the same key when they
   * differ from the original. Throws when sanitization yields an empty document so the caller
   * fails verification for hostile or zero-byte SVGs.
   */
  private async sanitizeStoredSvg(fileKey: string, contentType: string): Promise<void> {
    const object = await this.objectStorage.getObject(fileKey);
    const sanitized = sanitizeSvgBuffer(object.body);
    if (!sanitized.equals(object.body)) {
      await this.objectStorage.putObject({
        key: fileKey,
        body: sanitized,
        contentType,
      });
    }
  }

  /**
   * Fetches the stored object and confirms its leading magic bytes match `contentType`.
   * Returns false (so the caller fails verification and marks the row FAILED) when the
   * content does not match the declared type — closing the spoofed-content-type vector
   * where, e.g., an HTML/script payload is uploaded under an image MIME type.
   */
  private async verifyStoredObjectMagicBytes(
    fileKey: string,
    contentType: string,
  ): Promise<boolean> {
    const object = await this.objectStorage.getObject(fileKey);
    return verifyFileMagicBytes(object.body, contentType);
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

    await this.assertUserCanAccessOrgScopedUpload(row, userPublicId);

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
    // Stream the user's active uploads in bounded keyset batches and delete their S3 objects
    // with bounded concurrency. This prevents a user with a large upload footprint from
    // loading an unbounded result set into memory or serializing thousands of S3 round-trips
    // in the offboarding path. Rows are not mutated during iteration, so keyset-by-id pages
    // through the full set exactly once; the soft-delete at the end is the durable marker.
    let afterId = 0;
    for (;;) {
      const rows = await this.repository.findActiveByUserIdAfter(
        user_id,
        afterId,
        UPLOAD_OFFBOARDING_DELETE_BATCH_SIZE,
      );
      if (rows.length === 0) {
        break;
      }
      await this.deleteObjectsWithBoundedConcurrency({
        fileKeys: rows.map((row) => row.file_key),
        userId: user_id,
      });
      afterId = rows[rows.length - 1]!.id;
      if (rows.length < UPLOAD_OFFBOARDING_DELETE_BATCH_SIZE) {
        break;
      }
    }
    return this.repository.softDeleteAllByUserId(user_id);
  }

  /** Deletes S3 objects in fixed-size concurrent chunks; failures are logged, never thrown. */
  private async deleteObjectsWithBoundedConcurrency(options: {
    fileKeys: readonly string[];
    userId: number;
  }): Promise<void> {
    const { fileKeys, userId } = options;
    for (let index = 0; index < fileKeys.length; index += UPLOAD_OFFBOARDING_DELETE_CONCURRENCY) {
      const chunk = fileKeys.slice(index, index + UPLOAD_OFFBOARDING_DELETE_CONCURRENCY);
      await Promise.all(
        chunk.map(async (fileKey) => {
          const objectDeleted = await this.objectStorage.deleteObject(fileKey);
          if (!objectDeleted) {
            logger.warn({ userId, fileKey }, 'upload.offboarding.s3ObjectDeleteFailed');
          }
        }),
      );
    }
  }

  /** Tombstones org-scoped uploads (DB only; S3 removed on retention purge or per-upload DELETE). */
  async tombstoneAllByOrganizationId(organization_id: number): Promise<number> {
    return this.repository.softDeleteAllByOrganizationId(organization_id);
  }
}
