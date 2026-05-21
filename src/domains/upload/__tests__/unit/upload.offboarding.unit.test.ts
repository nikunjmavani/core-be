import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/storage/storage.service.js', () => ({
  deleteObject: vi.fn().mockResolvedValue(true),
  createPresignedUploadUrl: vi.fn(),
  headObject: vi.fn(),
  getObjectUrl: vi.fn(),
}));

vi.mock('@/domains/user/user.service.js', () => ({
  UserService: class UserService {},
}));

vi.mock('@/domains/tenancy/sub-domains/organization/organization.service.js', () => ({
  OrganizationService: class OrganizationService {},
}));

import { deleteObject } from '@/infrastructure/storage/storage.service.js';
import type { UploadRepository } from '@/domains/upload/upload.repository.js';
import { UploadService } from '@/domains/upload/upload.service.js';

describe('UploadService offboarding', () => {
  beforeEach(() => {
    vi.mocked(deleteObject).mockClear();
  });

  it('tombstoneAllByUserId deletes S3 objects before tombstoning rows', async () => {
    const repository = {
      findActiveByUserId: vi.fn().mockResolvedValue([
        { id: 1, file_key: 'avatars/user-1/a.png' },
        { id: 2, file_key: 'user-files/user-1/doc.pdf' },
      ]),
      softDeleteAllByUserId: vi.fn().mockResolvedValue(2),
    } as unknown as UploadRepository;

    const service = new UploadService(
      repository,
      {} as ConstructorParameters<typeof UploadService>[1],
      {} as ConstructorParameters<typeof UploadService>[2],
      { deleteObject } as unknown as ConstructorParameters<typeof UploadService>[3],
    );

    const count = await service.tombstoneAllByUserId(42);

    expect(count).toBe(2);
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith('avatars/user-1/a.png');
    expect(repository.softDeleteAllByUserId).toHaveBeenCalledWith(42);
  });
});
