import { beforeEach, describe, expect, it, vi } from 'vitest';

const headObjectMock = vi.fn();
const getObjectMock = vi.fn();
const deleteObjectMock = vi.fn();

vi.mock('@/infrastructure/storage/storage.service.js', () => ({
  headObject: (...arguments_: unknown[]) => headObjectMock(...arguments_),
  getObjectLeadingBytes: (...arguments_: unknown[]) => getObjectMock(...arguments_),
  deleteObject: (...arguments_: unknown[]) => deleteObjectMock(...arguments_),
}));

const findPendingUploadsOlderThanMock = vi.fn();
const setUploadStatusByInternalIdMock = vi.fn();
const hardDeleteUploadsByInternalIdsMock = vi.fn();

vi.mock('@/domains/upload/upload.repository.js', () => ({
  findPendingUploadsOlderThan: (...arguments_: unknown[]) =>
    findPendingUploadsOlderThanMock(...arguments_),
  setUploadStatusByInternalId: (...arguments_: unknown[]) =>
    setUploadStatusByInternalIdMock(...arguments_),
  hardDeleteUploadsByInternalIds: (...arguments_: unknown[]) =>
    hardDeleteUploadsByInternalIdsMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    UPLOAD_PENDING_SWEEP_GRACE_SECONDS: 3600,
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('@/shared/constants/ttl.constants.js', () => ({
  PRESIGNED_URL_EXPIRY_SECONDS: 900,
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: loggerMocks,
}));

import type { PendingUploadSweepRow } from '@/domains/upload/upload.repository.js';
import { runUploadPendingSweepJob } from '@/domains/upload/workers/upload-pending-sweep.processor.js';

function makeRow(overrides: Partial<PendingUploadSweepRow>): PendingUploadSweepRow {
  return {
    id: 1,
    public_id: 'upl_public_1',
    user_id: 10,
    file_key: 'avatars/owner/1.png',
    mime_type: 'image/png',
    file_size: 1024,
    created_at: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

const validPngBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('upload-pending-sweep.processor', () => {
  beforeEach(() => {
    headObjectMock.mockReset();
    getObjectMock.mockReset();
    deleteObjectMock.mockReset();
    findPendingUploadsOlderThanMock.mockReset();
    setUploadStatusByInternalIdMock.mockReset();
    hardDeleteUploadsByInternalIdsMock.mockResolvedValue(0);
    loggerMocks.info.mockReset();
    loggerMocks.warn.mockReset();
    loggerMocks.error.mockReset();
  });

  it('returns zero counters when no candidates are found', async () => {
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([]);
    const databaseHandle = {} as never;

    const result = await runUploadPendingSweepJob(databaseHandle);

    expect(result).toEqual({
      scannedCount: 0,
      autoConfirmedCount: 0,
      failedCount: 0,
      deletedCount: 0,
    });
    expect(headObjectMock).not.toHaveBeenCalled();
    expect(setUploadStatusByInternalIdMock).not.toHaveBeenCalled();
  });

  it('auto-confirms rows whose S3 object matches declared content length', async () => {
    const row = makeRow({ id: 1, file_key: 'avatars/owner/match.png', file_size: 2048 });
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([row]);
    headObjectMock.mockResolvedValueOnce({ contentType: 'image/png', contentLength: 2048 });
    getObjectMock.mockResolvedValueOnce({ body: validPngBody });
    const databaseHandle = {} as never;

    const result = await runUploadPendingSweepJob(databaseHandle);

    expect(setUploadStatusByInternalIdMock).toHaveBeenCalledWith(databaseHandle, 1, 'UPLOADED');
    expect(deleteObjectMock).not.toHaveBeenCalled();
    expect(result.autoConfirmedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.deletedCount).toBe(0);
  });

  it('auto-confirms when S3 omits the Content-Type but length matches', async () => {
    const row = makeRow({ id: 5, file_size: 999 });
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([row]);
    headObjectMock.mockResolvedValueOnce({ contentType: undefined, contentLength: 999 });
    getObjectMock.mockResolvedValueOnce({ body: validPngBody });

    const result = await runUploadPendingSweepJob({} as never);

    expect(result.autoConfirmedCount).toBe(1);
  });

  it('marks rows FAILED when magic bytes do not match declared content type', async () => {
    const row = makeRow({ id: 6, file_key: 'avatars/owner/spoof.png', file_size: 100 });
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([row]);
    headObjectMock.mockResolvedValueOnce({ contentType: 'image/png', contentLength: 100 });
    getObjectMock.mockResolvedValueOnce({ body: Buffer.from('%PDF-1.4') });
    const databaseHandle = {} as never;

    const result = await runUploadPendingSweepJob(databaseHandle);

    expect(setUploadStatusByInternalIdMock).toHaveBeenCalledWith(databaseHandle, 6, 'FAILED');
    expect(result.failedCount).toBe(1);
    expect(result.autoConfirmedCount).toBe(0);
  });

  it('marks rows FAILED when the S3 object content length does not match', async () => {
    const row = makeRow({ id: 2, file_key: 'avatars/owner/mismatch.png', file_size: 100 });
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([row]);
    headObjectMock.mockResolvedValueOnce({ contentType: 'image/png', contentLength: 50 });
    const databaseHandle = {} as never;

    const result = await runUploadPendingSweepJob(databaseHandle);

    expect(setUploadStatusByInternalIdMock).toHaveBeenCalledWith(databaseHandle, 2, 'FAILED');
    expect(result.failedCount).toBe(1);
    expect(result.autoConfirmedCount).toBe(0);
  });

  it('hard-deletes rows whose S3 object is missing', async () => {
    const row = makeRow({ id: 3, file_key: 'avatars/owner/orphan.png' });
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([row]);
    headObjectMock.mockResolvedValueOnce(null);
    deleteObjectMock.mockResolvedValueOnce(true);
    hardDeleteUploadsByInternalIdsMock.mockResolvedValueOnce(1);
    const databaseHandle = {} as never;

    const result = await runUploadPendingSweepJob(databaseHandle);

    expect(deleteObjectMock).toHaveBeenCalledWith('avatars/owner/orphan.png');
    expect(hardDeleteUploadsByInternalIdsMock).toHaveBeenCalledWith(databaseHandle, [3]);
    expect(result.deletedCount).toBe(1);
    expect(result.autoConfirmedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it('still records the verdict when S3 delete reports failure (defensive log)', async () => {
    const row = makeRow({ id: 4 });
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([row]);
    headObjectMock.mockResolvedValueOnce(null);
    deleteObjectMock.mockResolvedValueOnce(false);
    hardDeleteUploadsByInternalIdsMock.mockResolvedValueOnce(1);

    const result = await runUploadPendingSweepJob({} as never);

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 4 }),
      'upload-pending-sweep.s3DeleteFailed',
    );
    expect(result.deletedCount).toBe(1);
  });

  it('mixes auto-confirm, fail, and delete results in a single batch', async () => {
    const rows = [
      makeRow({ id: 11, file_size: 100 }),
      makeRow({ id: 12, file_size: 200 }),
      makeRow({ id: 13, file_size: 300 }),
    ];
    findPendingUploadsOlderThanMock.mockResolvedValueOnce(rows);
    headObjectMock
      .mockResolvedValueOnce({ contentType: undefined, contentLength: 100 })
      .mockResolvedValueOnce({ contentType: undefined, contentLength: 999 })
      .mockResolvedValueOnce(null);
    getObjectMock.mockResolvedValueOnce({ body: validPngBody });
    deleteObjectMock.mockResolvedValueOnce(true);
    hardDeleteUploadsByInternalIdsMock.mockResolvedValueOnce(1);

    const result = await runUploadPendingSweepJob({} as never);

    expect(result).toEqual({
      scannedCount: 3,
      autoConfirmedCount: 1,
      failedCount: 1,
      deletedCount: 1,
    });
  });

  it('uses presign expiry + grace as the cutoff passed to the repository', async () => {
    findPendingUploadsOlderThanMock.mockResolvedValueOnce([]);
    const now = Date.now();

    await runUploadPendingSweepJob({} as never);

    const callArguments = findPendingUploadsOlderThanMock.mock.calls[0];
    expect(callArguments).toBeDefined();
    const cutoff = callArguments![1] as Date;
    const expectedCutoffMs = now - (900 + 3600) * 1000;
    // Allow a small drift between Date.now snapshots.
    expect(Math.abs(cutoff.getTime() - expectedCutoffMs)).toBeLessThan(1000);
  });
});
