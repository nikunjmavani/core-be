import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUploadTombstoneRetentionJob } from '@/domains/upload/workers/upload-tombstone-retention.processor.js';

const deleteObjectMock = vi.fn();

vi.mock('@/infrastructure/storage/storage.service.js', () => ({
  deleteObject: (...arguments_: unknown[]) => deleteObjectMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { TOMBSTONE_RETENTION_DAYS: 30, LOG_LEVEL: 'silent' },
}));

const { loggerInfoMock } = vi.hoisted(() => ({ loggerInfoMock: vi.fn() }));
vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn() },
}));

function buildDatabaseHandle(batches: Array<Array<{ id: number; file_key: string }>>) {
  const limitMock = vi.fn();
  for (const batch of batches) {
    limitMock.mockResolvedValueOnce(batch);
  }
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));
  return {
    databaseHandle: { select: selectMock, delete: deleteMock },
    deleteMock,
    deleteWhereMock,
    selectMock,
  };
}

describe('upload-tombstone-retention.processor boundary cases', () => {
  beforeEach(() => {
    deleteObjectMock.mockReset();
    deleteObjectMock.mockResolvedValue(true);
    loggerInfoMock.mockReset();
  });

  it('purges only tombstones older than the cutoff', async () => {
    const oldRows = [
      { id: 1, file_key: 'uploads/old-1.png' },
      { id: 2, file_key: 'uploads/old-2.png' },
    ];
    const { databaseHandle, deleteMock } = buildDatabaseHandle([oldRows, []]);

    const result = await runUploadTombstoneRetentionJob(databaseHandle as never);

    expect(deleteObjectMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ deletedCount: 2 });
  });

  it('keeps rows at or younger than the cutoff (no rows matched)', async () => {
    const { databaseHandle, deleteMock } = buildDatabaseHandle([[]]);

    const result = await runUploadTombstoneRetentionJob(databaseHandle as never);

    expect(deleteObjectMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedCount: 0 });
  });

  it('logs purge counts on completion', async () => {
    const { databaseHandle } = buildDatabaseHandle([[{ id: 11, file_key: 'uploads/k.png' }], []]);

    await runUploadTombstoneRetentionJob(databaseHandle as never);

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ deletedCount: 1, retentionDays: 30 }),
      'upload-tombstone-retention.completed',
    );
  });
});
