import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUserDataExportRetentionJob } from '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.processor.js';

const deleteObjectMock = vi.fn();

vi.mock('@/infrastructure/storage/storage.service.js', () => ({
  deleteObject: (...arguments_: unknown[]) => deleteObjectMock(...arguments_),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('user-data-export-retention.processor', () => {
  beforeEach(() => {
    deleteObjectMock.mockReset();
    deleteObjectMock.mockResolvedValue(true);
  });

  it('runUserDataExportRetentionJob deletes S3 objects and purges expired export rows', async () => {
    const batch = [
      { id: 1, public_id: 'exp_1', s3_key: 'user-data-export/user/exp_1.json.gz' },
      { id: 2, public_id: 'exp_2', s3_key: 'user-data-export/user/exp_2.json.gz' },
    ];

    const limitMock = vi.fn().mockResolvedValueOnce(batch).mockResolvedValueOnce([]);
    const whereMock = vi.fn(() => ({ limit: limitMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));

    const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

    const databaseHandle = {
      select: selectMock,
      delete: deleteMock,
    };

    const result = await runUserDataExportRetentionJob(databaseHandle as never);

    expect(deleteObjectMock).toHaveBeenCalledTimes(2);
    expect(deleteObjectMock).toHaveBeenCalledWith('user-data-export/user/exp_1.json.gz');
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(deleteWhereMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ deletedCount: 2 });
  });

  it('runUserDataExportRetentionJob continues when S3 delete fails', async () => {
    deleteObjectMock.mockResolvedValue(false);

    const batch = [{ id: 3, public_id: 'exp_3', s3_key: 'user-data-export/user/exp_3.json.gz' }];
    const limitMock = vi.fn().mockResolvedValueOnce(batch).mockResolvedValueOnce([]);
    const whereMock = vi.fn(() => ({ limit: limitMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));
    const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

    const result = await runUserDataExportRetentionJob({
      select: selectMock,
      delete: deleteMock,
    } as never);

    expect(result).toEqual({ deletedCount: 1 });
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});
