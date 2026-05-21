import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRepository } from '@/domains/user/user.repository.js';

const mockReturning = vi.fn().mockResolvedValue([]);
const mockOffset = vi.fn().mockResolvedValue([]);
const mockLimit = vi.fn().mockResolvedValue([]);
const mockOrderBy = vi.fn(() => ({ limit: mockLimit, offset: mockOffset }));
const mockWhere = vi.fn(() => ({
  limit: mockLimit,
  returning: mockReturning,
  orderBy: mockOrderBy,
  offset: mockOffset,
}));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('@/shared/utils/infrastructure/postgres-error.util.js', () => ({
  runInsertWithPublicIdentifierRetry: async (operation: () => Promise<unknown>) => operation(),
}));

vi.mock('@/shared/utils/identity/public-id.util.js', () => ({
  generatePublicId: () => 'user_public_test',
}));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
}));

describe('UserRepository', () => {
  const repository = new UserRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockReset();
    mockLimit.mockReset();
    mockOffset.mockReset();
  });

  it('findByPublicId returns null when missing', async () => {
    mockLimit.mockResolvedValue([]);
    expect(await repository.findByPublicId('missing')).toBeNull();
  });

  it('findByEmail returns null when missing', async () => {
    mockLimit.mockResolvedValue([]);
    expect(await repository.findByEmail('missing@example.com')).toBeNull();
  });

  it('findById returns null when missing', async () => {
    mockLimit.mockResolvedValue([]);
    expect(await repository.findById(999)).toBeNull();
  });

  it('updatePassword returns null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.updatePassword('missing', 'hash')).toBeNull();
  });

  it('updateEmailVerified returns null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.updateEmailVerified('missing')).toBeNull();
  });

  it('update returns null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.update('missing', { first_name: 'A' })).toBeNull();
  });

  it('adminUpdate returns null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.adminUpdate('missing', { status: 'SUSPENDED' })).toBeNull();
  });

  it('suspend and unsuspend return null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.suspend('missing')).toBeNull();
    expect(await repository.unsuspend('missing')).toBeNull();
  });

  it('softDelete returns null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.softDelete('missing')).toBeNull();
  });

  it('updateLoginAttempt and updateMfaEnabled return null when user missing', async () => {
    mockReturning.mockResolvedValue([]);
    expect(await repository.updateLoginAttempt('missing', 1, null)).toBeNull();
    expect(await repository.updateMfaEnabled('missing', true)).toBeNull();
  });

  it('findMany returns empty result when no rows match', async () => {
    const mockOrderBy = vi.fn().mockResolvedValue([]);
    const mockOffset = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockLimit = vi.fn(() => ({ offset: mockOffset }));
    const mockWhereForList = vi.fn(() => ({
      limit: mockLimit,
      returning: vi.fn(),
      orderBy: vi.fn(() => ({ limit: mockLimit, offset: mockOffset })),
      offset: mockOffset,
    }));
    mockSelect
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: mockWhereForList })) })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        })),
      });

    const result = await repository.findMany({ page: 1, limit: 20, search: 'none' });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
