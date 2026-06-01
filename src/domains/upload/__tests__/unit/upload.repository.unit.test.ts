import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadRepository } from '@/domains/upload/upload.repository.js';

const mockReturning = vi.fn().mockResolvedValue([]);
const mockLimit = vi.fn().mockResolvedValue([]);
const mockWhere = vi.fn(() => ({ limit: mockLimit, returning: mockReturning }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('@/shared/utils/infrastructure/postgres-error.util.js', () => ({
  runInsertWithPublicIdentifierRetry: async (operation: () => Promise<unknown>) => operation(),
}));

vi.mock('@/shared/utils/identity/public-id.util.js', () => ({
  generatePublicId: () => 'upload_public_test',
}));

const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
}));

describe('UploadRepository', () => {
  const repository = new UploadRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockReturning.mockReset();
  });

  it('create inserts pending upload row', async () => {
    const row = { public_id: 'upload_public_test', status: 'PENDING' };
    mockReturning.mockResolvedValue([row]);

    const result = await repository.create({
      user_id: 1,
      file_name: 'avatar.png',
      file_key: 'avatars/key.png',
      mime_type: 'image/png',
      file_size: 1024,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(result).toEqual(row);
  });

  it('findByPublicId returns null when missing', async () => {
    mockLimit.mockResolvedValue([]);

    const result = await repository.findByPublicId('missing');

    expect(result).toBeNull();
  });

  it('findByPublicIdForUser scopes by user', async () => {
    const row = { public_id: 'upload_public_test', user_id: 1 };
    mockLimit.mockResolvedValue([row]);

    const result = await repository.findByPublicIdForUser('upload_public_test', 1);

    expect(result).toEqual(row);
  });

  it('softDelete returns null when upload missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.softDelete('missing', 1)).toBeNull();
  });

  it('softDeleteByPublicId returns null when upload missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.softDeleteByPublicId('missing')).toBeNull();
  });

  it('markStatusByPublicId returns updated row', async () => {
    const row = { public_id: 'upload_public_test', status: 'UPLOADED' };
    mockReturning.mockResolvedValue([row]);
    expect(await repository.markStatusByPublicId('upload_public_test', 'UPLOADED')).toEqual(row);
  });

  it('findActiveByUserId and findActiveByOrganizationId return active rows', async () => {
    const activeRows = [{ id: 1, file_key: 'avatars/key.png' }];
    mockWhere.mockReturnValueOnce({ limit: mockLimit, returning: mockReturning });
    mockFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue(activeRows) });

    const byUser = await repository.findActiveByUserId(1);
    expect(byUser).toEqual(activeRows);

    mockFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue(activeRows) });
    const byOrganization = await repository.findActiveByOrganizationId(10);
    expect(byOrganization).toEqual(activeRows);
  });

  it('softDeleteAllByUserId and softDeleteAllByOrganizationId return affected counts', async () => {
    mockReturning.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect(await repository.softDeleteAllByUserId(1)).toBe(2);
    expect(await repository.softDeleteAllByOrganizationId(10)).toBe(2);
  });
});
