import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
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
  getEnv: vi.fn(() => ({ S3_BUCKET: 'test-bucket', LOG_LEVEL: 'silent', UPLOAD_ALLOW_SVG: false })),
  env: { S3_BUCKET: 'test-bucket', LOG_LEVEL: 'silent', UPLOAD_ALLOW_SVG: false },
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
    softDelete: vi.fn().mockResolvedValue(uploadRow),
    softDeleteAllByUserId: vi.fn().mockResolvedValue(1),
    softDeleteAllByOrganizationId: vi.fn().mockResolvedValue(2),
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.findByPublicIdForUser).mockResolvedValue(uploadRow as never);
    vi.mocked(repository.softDelete).mockResolvedValue(uploadRow as never);
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

  it('createUpload throws when S3 bucket is not configured', async () => {
    const { getEnv } = await import('@/shared/config/env.config.js');
    vi.mocked(getEnv).mockReturnValueOnce({
      S3_BUCKET: undefined,
      LOG_LEVEL: 'silent',
      UPLOAD_ALLOW_SVG: false,
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
