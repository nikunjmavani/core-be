import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/errors/index.js';
import { UploadService } from '@/domains/upload/upload.service.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { UploadRepository } from '@/domains/upload/upload.repository.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';

import { createObjectStoragePortMock } from '@/tests/helpers/object-storage-mock.helper.js';
import { resolveUserOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';

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
    findByPublicId: vi.fn().mockResolvedValue(uploadRow),
    findByPublicIdForUser: vi.fn().mockResolvedValue(uploadRow),
    findActiveByUserId: vi.fn().mockResolvedValue([uploadRow]),
    findActiveByUserIdAfter: vi.fn().mockResolvedValue([uploadRow]),
    markStatus: vi.fn().mockResolvedValue(uploadRow),
    markStatusByPublicId: vi.fn().mockResolvedValue(uploadRow),
    softDelete: vi.fn().mockResolvedValue(uploadRow),
    softDeleteByPublicId: vi.fn().mockResolvedValue(uploadRow),
    softDeleteAllByUserId: vi.fn().mockResolvedValue(1),
    softDeleteAllByOrganizationId: vi.fn().mockResolvedValue(2),
    countPendingByUserId: vi.fn().mockResolvedValue(0),
    acquirePendingUploadQuotaLock: vi.fn().mockResolvedValue(undefined),
  } as unknown as UploadRepository;

  const userService = {
    requireUserRecordByPublicId: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const organizationService = {
    requireOrganizationByPublicId: vi.fn().mockResolvedValue({ id: 10, public_id: 'org_public' }),
    findOrganizationByInternalId: vi.fn().mockResolvedValue({ id: 10, public_id: 'org_public' }),
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
    vi.mocked(repository.findByPublicId).mockResolvedValue(uploadRow as never);
    vi.mocked(repository.softDeleteByPublicId).mockResolvedValue(uploadRow as never);
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
    const { resolveUserOrganizationPermissions } = await import(
      '@/domains/tenancy/sub-domains/permission/authorization.service.js'
    );
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
    expect(repository.softDeleteByPublicId).toHaveBeenCalled();
  });

  it('deleteUpload allows org managers to delete teammate-created organization uploads', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      user_id: 99,
      organization_id: 10,
    } as never);

    await service.deleteUpload(uploadPublicId, userPublicId);

    expect(objectStorage.deleteObject).toHaveBeenCalledWith(uploadRow.file_key);
    expect(repository.softDeleteByPublicId).toHaveBeenCalledWith(uploadPublicId);
  });

  it('deleteUpload hides personal uploads owned by another user', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      user_id: 99,
      organization_id: null,
    } as never);

    await expect(service.deleteUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(objectStorage.deleteObject).not.toHaveBeenCalled();
    expect(repository.softDeleteByPublicId).not.toHaveBeenCalled();
  });

  it('deleteUpload rejects org-scoped upload when caller lacks upload:manage', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      organization_id: 10,
    } as never);
    vi.mocked(resolveUserOrganizationPermissions).mockResolvedValueOnce([]);

    await expect(service.deleteUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(objectStorage.deleteObject).not.toHaveBeenCalled();
    expect(repository.softDeleteByPublicId).not.toHaveBeenCalled();
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
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
    await expect(service.getUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('tombstoneAllByUserId soft-deletes user uploads', async () => {
    vi.mocked(repository.findActiveByUserIdAfter).mockResolvedValue([uploadRow] as never);
    vi.mocked(repository.softDeleteAllByUserId).mockResolvedValue(1);
    const count = await service.tombstoneAllByUserId(1);
    expect(count).toBe(1);
  });

  it('tombstoneAllByOrganizationId soft-deletes organization uploads', async () => {
    vi.mocked(repository.softDeleteAllByOrganizationId).mockResolvedValue(2);
    const count = await service.tombstoneAllByOrganizationId(10);
    expect(count).toBe(2);
  });

  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

  it('confirmUpload marks UPLOADED when the object matches declared type, size, and magic bytes', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      status: 'PENDING',
    } as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/png',
      contentLength: 1024,
    });
    vi.mocked(objectStorage.getObject).mockResolvedValueOnce({
      body: PNG_MAGIC,
      contentType: 'image/png',
    });
    vi.mocked(repository.markStatusByPublicId).mockResolvedValue({
      ...uploadRow,
      status: 'UPLOADED',
    } as never);

    const result = await service.confirmUpload(uploadPublicId, userPublicId);

    expect(objectStorage.verifyUploadedObject).toHaveBeenCalledWith(uploadRow.file_key, {
      contentType: 'image/png',
      contentLength: 1024,
    });
    expect(repository.markStatusByPublicId).toHaveBeenCalledWith(uploadPublicId, 'UPLOADED');
    expect(result.status).toBe('UPLOADED');
  });

  it('confirmUpload allows org managers to confirm teammate-created organization uploads', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      user_id: 99,
      organization_id: 10,
      status: 'PENDING',
    } as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/png',
      contentLength: 1024,
    });
    vi.mocked(objectStorage.getObject).mockResolvedValueOnce({
      body: PNG_MAGIC,
      contentType: 'image/png',
    });
    vi.mocked(repository.markStatusByPublicId).mockResolvedValue({
      ...uploadRow,
      user_id: 99,
      organization_id: 10,
      status: 'UPLOADED',
    } as never);

    const result = await service.confirmUpload(uploadPublicId, userPublicId);

    expect(result.status).toBe('UPLOADED');
    expect(repository.markStatusByPublicId).toHaveBeenCalledWith(uploadPublicId, 'UPLOADED');
  });

  it('confirmUpload marks FAILED when magic bytes do not match the declared type (spoofed content)', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      status: 'PENDING',
    } as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/png',
      contentLength: 1024,
    });
    // HEAD says image/png, but the stored bytes are HTML — a stored-XSS / content-spoof attempt.
    vi.mocked(objectStorage.getObject).mockResolvedValueOnce({
      body: Buffer.from('<html><script>alert(1)</script></html>'),
      contentType: 'image/png',
    });

    await expect(service.confirmUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repository.markStatusByPublicId).toHaveBeenCalledWith(uploadPublicId, 'FAILED');
  });

  it('confirmUpload marks FAILED and throws when object size does not match', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
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
    expect(repository.markStatusByPublicId).toHaveBeenCalledWith(uploadPublicId, 'FAILED');
  });

  it('confirmUpload sanitizes a stored SVG in place before marking UPLOADED', async () => {
    const svgRow = {
      ...uploadRow,
      file_name: 'logo.svg',
      file_key: 'avatars/user_public/key.svg',
      mime_type: 'image/svg+xml',
      file_size: 80,
      status: 'PENDING',
    };
    vi.mocked(repository.findByPublicId).mockResolvedValue(svgRow as never);
    vi.mocked(repository.markStatusByPublicId).mockResolvedValue({
      ...svgRow,
      status: 'UPLOADED',
    } as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/svg+xml',
      contentLength: 80,
    });
    const hostileSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="5"/></svg>',
      'utf8',
    );
    vi.mocked(objectStorage.getObject).mockResolvedValueOnce({
      body: hostileSvg,
      contentType: 'image/svg+xml',
    });

    const result = await service.confirmUpload(uploadPublicId, userPublicId);

    expect(objectStorage.getObject).toHaveBeenCalledWith(svgRow.file_key);
    expect(objectStorage.putObject).toHaveBeenCalledTimes(1);
    const putArgs = vi.mocked(objectStorage.putObject).mock.calls[0]?.[0];
    expect(putArgs?.key).toBe(svgRow.file_key);
    expect(putArgs?.contentType).toBe('image/svg+xml');
    const rewritten = (putArgs?.body as Buffer).toString('utf8');
    expect(rewritten).not.toMatch(/<script/i);
    expect(rewritten).not.toMatch(/\bon\w+\s*=/i);
    expect(result.status).toBe('UPLOADED');
  });

  it('confirmUpload marks FAILED when an SVG sanitizes to empty content (hostile/zero-byte)', async () => {
    const svgRow = {
      ...uploadRow,
      file_key: 'avatars/user_public/empty.svg',
      mime_type: 'image/svg+xml',
      file_size: 12,
      status: 'PENDING',
    };
    vi.mocked(repository.findByPublicId).mockResolvedValue(svgRow as never);
    vi.mocked(objectStorage.verifyUploadedObject).mockResolvedValueOnce({
      contentType: 'image/svg+xml',
      contentLength: 12,
    });
    vi.mocked(objectStorage.getObject).mockResolvedValueOnce({
      body: Buffer.from('<script>alert(1)</script>', 'utf8'),
      contentType: 'image/svg+xml',
    });

    await expect(service.confirmUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repository.markStatusByPublicId).toHaveBeenCalledWith(uploadPublicId, 'FAILED');
    expect(objectStorage.putObject).not.toHaveBeenCalled();
  });

  it('confirmUpload is idempotent for already-UPLOADED rows', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      status: 'UPLOADED',
    } as never);

    const result = await service.confirmUpload(uploadPublicId, userPublicId);
    expect(result.status).toBe('UPLOADED');
    expect(objectStorage.verifyUploadedObject).not.toHaveBeenCalled();
    expect(repository.markStatusByPublicId).not.toHaveBeenCalled();
  });

  it('confirmUpload rejects when the upload is not pending', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...uploadRow,
      status: 'FAILED',
    } as never);

    await expect(service.confirmUpload(uploadPublicId, userPublicId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(objectStorage.verifyUploadedObject).not.toHaveBeenCalled();
  });

  it('confirmUpload throws NotFound when the upload is missing', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
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
    // Reservation takes the per-user advisory lock before counting, and never inserts
    // a row or mints a presigned URL once the cap is reached.
    expect(repository.acquirePendingUploadQuotaLock).toHaveBeenCalledWith(user.id);
    expect(repository.countPendingByUserId).toHaveBeenCalledWith(user.id);
    expect(repository.create).not.toHaveBeenCalled();
    expect(objectStorage.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(objectStorage.createPresignedUploadPost).not.toHaveBeenCalled();
  });

  it('createUpload reserves the pending slot before minting the presigned URL', async () => {
    const callOrder: string[] = [];
    vi.mocked(repository.acquirePendingUploadQuotaLock).mockImplementationOnce(async () => {
      callOrder.push('lock');
    });
    vi.mocked(repository.create).mockImplementationOnce(async () => {
      callOrder.push('create');
      return uploadRow as never;
    });
    vi.mocked(objectStorage.createPresignedUploadUrl).mockImplementationOnce(async () => {
      callOrder.push('presign');
      return 'https://presigned.example/upload';
    });

    await service.createUpload(
      {
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'avatar.png',
        fileSize: 1024,
      },
      userPublicId,
    );

    expect(callOrder).toEqual(['lock', 'create', 'presign']);
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
