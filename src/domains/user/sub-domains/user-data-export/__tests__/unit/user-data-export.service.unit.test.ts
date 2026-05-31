import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { NotFoundError } from '@/shared/errors/index.js';
import {
  capExportCategory,
  UserDataExportService,
} from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import { GDPR_EXPORT_MAX_ROWS_PER_TABLE } from '@/shared/constants/query-limits.constants.js';
import { createObjectStoragePortMock } from '@/tests/helpers/object-storage-mock.helper.js';
import {
  USER_DATA_EXPORT_STATUSES,
  UserDataExportCancelledError,
} from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';
import { USER_DATA_EXPORT_PRESIGNED_DOWNLOAD_EXPIRY_SECONDS } from '@/shared/constants/ttl.constants.js';

const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin, where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => ({ select: mockSelect }),
}));

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: (_userPublicId: string, callback: (handle: unknown) => unknown) =>
    callback({ select: mockSelect }),
}));

vi.mock('@/domains/user/sub-domains/user-data-export/queues/user-data-export.queue.js', () => ({
  enqueueUserDataExport: vi.fn().mockResolvedValue(undefined),
}));

const { workerExportRepository } = vi.hoisted(() => ({
  workerExportRepository: {
    findByPublicIdAndUserId: vi.fn(),
  },
}));

vi.mock('@/domains/user/sub-domains/user-data-export/user-data-export.repository.js', () => ({
  createWorkerUserDataExportRepository: () => workerExportRepository,
}));

const userRecord = {
  id: 1,
  public_id: 'user_public',
  email: 'user@example.com',
  first_name: null,
  last_name: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('UserDataExportService', () => {
  const userService = {
    findUserRecordByPublicId: vi.fn(),
  };
  const exportRepository = {
    create: vi.fn(),
    findPendingOrProcessingByUserId: vi.fn().mockResolvedValue(null),
    findByPublicIdAndUserId: vi.fn(),
    listByUserId: vi.fn(),
    updateStatus: vi.fn(),
    deleteAllByUserId: vi.fn(),
  };
  const objectStorage = createObjectStoragePortMock();
  const service = new UserDataExportService(
    userService as never,
    exportRepository as never,
    objectStorage,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin });
    mockWhere.mockImplementation(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    userService.findUserRecordByPublicId.mockResolvedValue(userRecord);
  });

  it('buildExportPayload returns aggregated user data', async () => {
    mockLimit
      .mockResolvedValueOnce([userRecord])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockDatabaseHandle = { select: mockSelect };
    const result = await service.buildExportPayload(
      'user_public',
      mockDatabaseHandle as unknown as RequestScopedPostgresDatabase,
    );

    expect(result.user.email).toBe('user@example.com');
    expect(result.organizations).toEqual([]);
    expect(result.exported_at).toBeDefined();
  });

  it('buildExportPayload throws when user is missing', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const mockDatabaseHandle = { select: mockSelect };
    await expect(
      service.buildExportPayload(
        'missing',
        mockDatabaseHandle as unknown as RequestScopedPostgresDatabase,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requestExport creates row and defers enqueue until flushOnCommit', async () => {
    const { enqueueUserDataExport } = await import(
      '@/domains/user/sub-domains/user-data-export/queues/user-data-export.queue.js'
    );
    exportRepository.create.mockResolvedValue({
      public_id: 'exp_test',
      status: USER_DATA_EXPORT_STATUSES.PENDING,
      expires_at: new Date(),
      created_at: new Date(),
    });

    enterOnCommitScope();
    const result = await service.requestExport('user_public');

    expect(exportRepository.create).toHaveBeenCalled();
    expect(enqueueUserDataExport).not.toHaveBeenCalled();

    await eventBus.flushOnCommit();
    expect(enqueueUserDataExport).toHaveBeenCalledWith(
      expect.objectContaining({
        userPublicId: 'user_public',
        userInternalId: userRecord.id,
      }),
    );
    expect(result.status).toBe(USER_DATA_EXPORT_STATUSES.PENDING);
  });

  it('getExportStatus uses 24h presigned download expiry for completed exports', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    exportRepository.findByPublicIdAndUserId.mockResolvedValue({
      public_id: 'exp_dl',
      status: USER_DATA_EXPORT_STATUSES.COMPLETED,
      s3_key: 'user-data-export/user/exp_dl.json.gz',
      expires_at: expiresAt,
      completed_at: new Date(),
      failed_at: null,
      error_code: null,
      created_at: new Date(),
    });
    objectStorage.createPresignedDownloadUrl.mockResolvedValue('https://example.com/download');

    await service.getExportStatus('user_public', 'exp_dl');

    expect(objectStorage.createPresignedDownloadUrl).toHaveBeenCalledWith({
      key: 'user-data-export/user/exp_dl.json.gz',
      expiresInSeconds: USER_DATA_EXPORT_PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
    });
  });

  it('isExportJobCancelled returns true when export row is missing', async () => {
    workerExportRepository.findByPublicIdAndUserId.mockResolvedValue(null);
    const mockDatabaseHandle = { select: mockSelect };

    const cancelled = await service.isExportJobCancelled(
      'exp_missing',
      1,
      mockDatabaseHandle as never,
    );

    expect(cancelled).toBe(true);
  });

  it('isExportJobCancelled returns true when user is soft-deleted', async () => {
    workerExportRepository.findByPublicIdAndUserId.mockResolvedValue({
      public_id: 'exp_1',
      s3_key: 'user-data-export/user/exp_1.json.gz',
    });
    mockLimit.mockResolvedValueOnce([{ deleted_at: new Date() }]);
    const mockDatabaseHandle = { select: mockSelect };

    const cancelled = await service.isExportJobCancelled('exp_1', 1, mockDatabaseHandle as never);

    expect(cancelled).toBe(true);
  });

  it('completeExportJob skips S3 when export row was removed', async () => {
    workerExportRepository.findByPublicIdAndUserId.mockResolvedValue(null);
    const mockDatabaseHandle = { select: mockSelect };

    await expect(
      service.completeExportJob(
        { exportPublicId: 'exp_gone', userInternalId: 1, body: Buffer.from('x') },
        mockDatabaseHandle as never,
      ),
    ).rejects.toBeInstanceOf(UserDataExportCancelledError);

    expect(objectStorage.putObject).not.toHaveBeenCalled();
  });

  it('deleteAllExportsForUser removes S3 objects and database rows', async () => {
    exportRepository.listByUserId.mockResolvedValue([
      { public_id: 'exp_1', s3_key: 'user-data-export/user/exp_1.json.gz' },
    ]);
    exportRepository.deleteAllByUserId.mockResolvedValue(1);

    await service.deleteAllExportsForUser(1, 'user_public');

    expect(objectStorage.deleteObject).toHaveBeenCalledWith('user-data-export/user/exp_1.json.gz');
    expect(exportRepository.deleteAllByUserId).toHaveBeenCalledWith(1);
  });
});

describe('capExportCategory', () => {
  it('returns rows untouched and records no truncation when under the cap', () => {
    const truncated: string[] = [];
    const rows = Array.from({ length: GDPR_EXPORT_MAX_ROWS_PER_TABLE }, (_, index) => index);

    const result = capExportCategory(rows, 'sessions', truncated);

    expect(result).toHaveLength(GDPR_EXPORT_MAX_ROWS_PER_TABLE);
    expect(truncated).toEqual([]);
  });

  it('slices to the cap and records the category when the cap is exceeded', () => {
    const truncated: string[] = [];
    const rows = Array.from({ length: GDPR_EXPORT_MAX_ROWS_PER_TABLE + 5 }, (_, index) => index);

    const result = capExportCategory(rows, 'audit_activity', truncated);

    expect(result).toHaveLength(GDPR_EXPORT_MAX_ROWS_PER_TABLE);
    expect(truncated).toEqual(['audit_activity']);
  });
});
