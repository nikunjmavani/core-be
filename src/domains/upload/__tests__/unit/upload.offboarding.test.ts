import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createObjectStoragePortMock } from '@/tests/helpers/object-storage-mock.helper.js';
import type { UploadRepository } from '@/domains/upload/upload.repository.js';
import { UploadService } from '@/domains/upload/upload.service.js';

describe('UploadService offboarding', () => {
  const objectStorage = createObjectStoragePortMock();

  beforeEach(() => {
    vi.mocked(objectStorage.deleteObject).mockClear();
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
      objectStorage,
    );

    const count = await service.tombstoneAllByUserId(42);

    expect(count).toBe(2);
    expect(objectStorage.deleteObject).toHaveBeenCalledTimes(2);
    expect(objectStorage.deleteObject).toHaveBeenCalledWith('avatars/user-1/a.png');
    expect(repository.softDeleteAllByUserId).toHaveBeenCalledWith(42);
  });
});
