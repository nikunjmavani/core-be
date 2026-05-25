import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/errors/index.js';
import { UploadService } from '@/domains/upload/upload.service.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { UploadRepository } from '@/domains/upload/upload.repository.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';

import { createObjectStoragePortMock } from '@/tests/helpers/object-storage-mock.helper.js';

vi.mock('@/domains/tenancy/sub-domains/permission/authorization.service.js', () => ({
  resolveUserOrganizationPermissions: vi.fn().mockResolvedValue(['upload:manage']),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  getEnv: vi.fn(() => ({
    S3_BUCKET: 'test-bucket',
    LOG_LEVEL: 'silent',
    UPLOAD_ALLOW_SVG: false,
    UPLOAD_MAX_PENDING_PER_USER: 100,
  })),
  env: {
    S3_BUCKET: 'test-bucket',
    LOG_LEVEL: 'silent',
    UPLOAD_ALLOW_SVG: false,
    UPLOAD_MAX_PENDING_PER_USER: 100,
  },
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

const userPublicId = generatePublicId();
const uploadPublicId = generatePublicId();
const user = { id: 1, public_id: userPublicId };
const uploadRow = {
  id: 2,
  public_id: uploadPublicId,
  user_id: 1,
  organization_id: null,
  file_name: 'avatar.png',
  file_key: 'avatars/user_public/key.png',
  mime_type: 'image/png',
  file_size: 1024,
  storage_provider: 's3',
  bucket: 'test-bucket',
  status: 'PENDING',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

describe('UploadService', () => {
  const repository = {
    create: vi.fn().mockResolvedValue(uploadRow),
    findByPublicIdForUser: vi.fn().mockResolvedValue(uploadRow),
    findActiveByUserId: vi.fn().mockResolvedValue([uploadRow]),
    markStatus: vi.fn().mockResolvedValue(uploadRow),
    softDelete: vi.fn().mockResolvedValue(uploadRow),
    softDeleteAllByUserId: vi.fn().mockResolvedValue(1),
    softDeleteAllByOrganizationId: vi.fn().mockResolvedValue(2),
    countPendingByUserId: vi.fn().mockResolvedValue(0),
  } as unknown as UploadRepository;

  const userService = {
    requireUserRecordByPublicId: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const organizationService = {
    requireOrganizationByPublicId: vi.fn().mockResolvedValue({ id: 10, public_id: 'org_public' }),
    findOrganizationByInternalId: vi.fn().mockResolvedValue(null),
  } as unknown as OrganizationService;

  const objectStorage = createObjectStoragePortMock();
  const service = new UploadService(repository, userService, organizationService, objectStorage);

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getEnv } = await import('@/shared/config/env.config.js');
    vi.mocked(getEnv).mockReturnValue({
      S3_BUCKET: 'test-bucket',
      LOG_LEVEL: 'silent',
      UPLOAD_ALLOW_SVG: false,
      UPLOAD_MAX_PENDING_PER_USER: 100,
    } as ReturnType<typeof getEnv>);
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue(uploadRow as never);
    vi.mocked(repository.softDelete).mockResolvedValue(uploadRow as never);
    vi.mocked(repository.countPendingByUserId).mockResolvedValue(0);
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(user as never);
  });

  it('createUpload returns presigned url for user avatar', async () => {
    const result = await service.createUpload(
      {
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'avatar.png',
        fileSize: 1024,
      },
      userPublicId,
    );
    expect(result.uploadUrl).toContain('https://');
    expect(repository.create).toHaveBeenCalled();
  });

  it('createUpload returns a presigned POST with content-length-range when enabled', async () => {
    const { getEnv } = await import('@/shared/config/env.config.js');
    // createUpload calls getEnv twice (once for the pending cap, once for the bucket/presign env).
    vi.mocked(getEnv).mockReturnValue({
      S3_BUCKET: 'test-bucket',
      LOG_LEVEL: 'silent',
      UPLOAD_ALLOW_SVG: false,
      UPLOAD_USE_PRESIGNED_POST: true,
      UPLOAD_MAX_PENDING_PER_USER: 100,
    } as ReturnType<typeof getEnv>);
    vi.mocked(objectStorage.createPresignedUploadPost).mockResolvedValueOnce({
      url: 'https://s3.example/post',
      fields: { key: 'avatars/u/x.png', policy: 'p', 'Content-Type': 'image/png' },
    });

    const result = await service.createUpload(
      {
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'avatar.png',
        fileSize: 1024,
      },
      userPublicId,
    );

    expect(objectStorage.createPresignedUploadPost).toHaveBeenCalledWith(
      expect.objectContaining({ minContentLength: 1, maxContentLength: 2 * 1024 * 1024 }),
    );
    expect(objectStorage.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(result.uploadMethod).toBe('POST');
    expect(result.fields).toMatchObject({ 'Content-Type': 'image/png' });
  });

  it('createUpload rejects organization upload without manage permission', async () => {
    const { resolveUserOrganizationPermissions } =
      await import('@/domains/tenancy/sub-domains/permission/authorization.service.js');
    vi.mocked(resolveUserOrganizationPermissions).mockResolvedValueOnce([]);

    await expect(
      service.createUpload(
        {
          purpose: 'organization-logo',
          for: 'organization',
          organizationId: 'org_public',
          contentType: 'image/png',
          fileName: 'logo.png',
          fileSize: 2048,
        },
        userPublicId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('getUpload returns serialized upload', async () => {
    const result = await service.getUpload(uploadPublicId, userPublicId);
    expect(result.publicId).toBe(uploadPublicId);
  });

  it('deleteUpload removes upload for user', async () => {
    await service.deleteUpload(uploadPublicId, userPublicId);
    expect(repository.softDelete).toHaveBeenCalled();
  });

  it('createUpload succeeds for organization logo with permission', async () => {
    const result = await service.createUpload(
      {
        purpose: 'organization-logo',
        for: 'organization',
        organizationId: 'org_public',
        contentType: 'image/png',
        fileName: 'logo.png',
        fileSize: 2048,
      },
      userPublicId,
    );
    expect(result.uploadUrl).toContain('https://');
  });

  it('getUpload throws when upload is missing', async () => {
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue(null);
    await expect(service.getUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('tombstoneAllByUserId soft-deletes user uploads', async () => {
    vi.mocked(repository.findActiveByUserId).mockResolvedValue([uploadRow] as never);
    vi.mocked(repository.softDeleteAllByUserId).mockResolvedValue(1);
    const count = await service.tombstoneAllByUserId(1);
    expect(count).toBe(1);
  });

  it('tombstoneAllByOrganizationId soft-deletes organization uploads', async () => {
    vi.mocked(repository.softDeleteAllByOrganizationId).mockResolvedValue(2);
    const count = await service.tombstoneAllByOrganizationId(10);
    expect(count).toBe(2);
  });

  it('confirmUpload marks UPLOADED when the object matches declared type and size', async () => {
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue({
      ...uploadRow,
      status: 'PENDING',
    } as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/png',
      contentLength: 1024,
    });
    vi.mocked(repository.markStatus).mockResolvedValue({
      ...uploadRow,
      status: 'UPLOADED',
    } as never);

    const result = await service.confirmUpload(uploadPublicId, userPublicId);

    expect(objectStorage.verifyUploadedObject).toHaveBeenCalledWith(uploadRow.file_key, {
      contentType: 'image/png',
      contentLength: 1024,
    });
    expect(repository.markStatus).toHaveBeenCalledWith(uploadPublicId, user.id, 'UPLOADED');
    expect(result.status).toBe('UPLOADED');
  });

  it('confirmUpload marks FAILED and throws when object size does not match', async () => {
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue({
      ...uploadRow,
      status: 'PENDING',
    } as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/png',
      contentLength: 9999,
    });

    await expect(service.confirmUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repository.markStatus).toHaveBeenCalledWith(uploadPublicId, user.id, 'FAILED');
  });

  it('confirmUpload is idempotent for already-UPLOADED rows', async () => {
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue({
      ...uploadRow,
      status: 'UPLOADED',
    } as never);

    const result = await service.confirmUpload(uploadPublicId, userPublicId);
    expect(result.status).toBe('UPLOADED');
    expect(objectStorage.verifyUploadedObject).not.toHaveBeenCalled();
    expect(repository.markStatus).not.toHaveBeenCalled();
  });

  it('confirmUpload rejects when the upload is not pending', async () => {
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue({
      ...uploadRow,
      status: 'FAILED',
    } as never);

    await expect(service.confirmUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(objectStorage.verifyUploadedObject).not.toHaveBeenCalled();
  });

  it('confirmUpload throws NotFound when the upload is missing', async () => {
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue(null);
    await expect(service.confirmUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('createUpload rejects when the user is at the PENDING upload cap', async () => {
    vi.mocked(repository.countPendingByUserId).mockResolvedValueOnce(100);

    await expect(
      service.createUpload(
        {
          purpose: 'avatar',
          for: 'user',
          contentType: 'image/png',
          fileName: 'avatar.png',
          fileSize: 1024,
        },
        userPublicId,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('createUpload allows when pending count is just below the cap', async () => {
    vi.mocked(repository.countPendingByUserId).mockResolvedValueOnce(99);

    const result = await service.createUpload(
      {
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'avatar.png',
        fileSize: 1024,
      },
      userPublicId,
    );

    expect(result.uploadUrl).toContain('https://');
    expect(repository.create).toHaveBeenCalled();
  });

  it('createUpload throws when S3 bucket is not configured', async () => {
    const { getEnv } = await import('@/shared/config/env.config.js');
    vi.mocked(getEnv).mockReturnValue({
      S3_BUCKET: undefined,
      LOG_LEVEL: 'silent',
      UPLOAD_ALLOW_SVG: false,
      UPLOAD_MAX_PENDING_PER_USER: 100,
    } as ReturnType<typeof getEnv>);
    await expect(
      service.createUpload(
        {
          purpose: 'avatar',
          for: 'user',
          contentType: 'image/png',
          fileName: 'avatar.png',
          fileSize: 1024,
        },
        userPublicId,
      ),
    ).rejects.toThrow('S3_BUCKET is not configured');
  });
});
