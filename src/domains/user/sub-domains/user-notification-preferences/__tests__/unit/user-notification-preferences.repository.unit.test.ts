import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserNotificationPreferencesRepository } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.repository.js';

function createMockDatabase() {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockWhereDelete = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn().mockReturnValue({ where: mockWhereDelete });
  const mockWhereSelect = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhereSelect });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  // replaceAll acquires a per-user pg_advisory_xact_lock via `execute(...)` before
  // the delete-then-insert, so the mock DB must expose `execute` like the real handle.
  const mockExecute = vi.fn().mockResolvedValue(undefined);

  return {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
    execute: mockExecute,
    mockReturning,
    mockValues,
    mockFrom,
    mockWhereSelect,
    mockWhereDelete,
    mockInsert,
    mockDelete,
    mockSelect,
    mockExecute,
  };
}

const mockDatabase = createMockDatabase();

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => mockDatabase,
}));

describe('UserNotificationPreferencesRepository', () => {
  const repository = new UserNotificationPreferencesRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.mockReturning.mockResolvedValue([]);
    mockDatabase.mockWhereSelect.mockResolvedValue([]);
    mockDatabase.mockWhereDelete.mockResolvedValue(undefined);
    mockDatabase.mockSelect.mockReturnValue({ from: mockDatabase.mockFrom });
    mockDatabase.mockFrom.mockReturnValue({ where: mockDatabase.mockWhereSelect });
    mockDatabase.mockDelete.mockReturnValue({ where: mockDatabase.mockWhereDelete });
    mockDatabase.mockInsert.mockReturnValue({ values: mockDatabase.mockValues });
    mockDatabase.mockExecute.mockResolvedValue(undefined);
  });

  it('listByUserId queries preferences for user', async () => {
    mockDatabase.mockWhereSelect.mockResolvedValueOnce([
      { id: 1, notification_type: 'SUBSCRIPTION_UPDATED' },
    ]);
    const rows = await repository.listByUserId(10);
    expect(rows).toHaveLength(1);
    expect(mockDatabase.mockSelect).toHaveBeenCalled();
  });

  it('replaceAll deletes existing preferences and inserts new rows', async () => {
    mockDatabase.mockReturning.mockResolvedValueOnce([
      {
        id: 2,
        notification_type: 'SUBSCRIPTION_UPDATED',
        channel: 'EMAIL',
        organization_id: null,
        is_enabled: true,
      },
    ]);

    const rows = await repository.replaceAll(
      10,
      [
        {
          notification_type: 'SUBSCRIPTION_UPDATED',
          channel: 'EMAIL',
          organization_id: null,
          is_enabled: true,
        },
      ],
      10,
    );

    expect(rows).toHaveLength(1);
    // the per-user advisory lock must be acquired before the replace mutation
    expect(mockDatabase.mockExecute).toHaveBeenCalled();
    expect(mockDatabase.mockDelete).toHaveBeenCalled();
    expect(mockDatabase.mockInsert).toHaveBeenCalled();
  });

  it('replaceAll returns empty array when preferences list is empty', async () => {
    const rows = await repository.replaceAll(10, [], 10);
    expect(rows).toEqual([]);
    expect(mockDatabase.mockDelete).toHaveBeenCalled();
    expect(mockDatabase.mockInsert).not.toHaveBeenCalled();
  });
});
