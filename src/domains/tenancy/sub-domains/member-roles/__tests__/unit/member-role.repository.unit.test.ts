import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';

/**
 * Drizzle chains: `select(...).from(...).where(...)` returns a count query;
 * `select().from(...).where(...).orderBy(...).limit(...).offset(...)` returns the rows.
 * `countAwaitable` makes the `.where(...)` returned by the count chain thenable so
 * `await getRequestDatabase().select({count}).from(...).where(...)` resolves to the
 * mocked count rows.
 */
const countAwaitable = {
  then: (resolve: (value: Array<{ count: number }>) => void) => resolve([{ count: 0 }]),
};

const mockCountWhere = vi.fn(() => countAwaitable);
const mockCountFrom = vi.fn(() => ({ where: mockCountWhere }));

const mockOffset = vi.fn();
const mockLimit = vi.fn(() => ({ offset: mockOffset }));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhereRows = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFromRows = vi.fn(() => ({ where: mockWhereRows }));
const mockSelect = vi.fn();

const mockReturning = vi.fn();
const mockSet = vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('@/shared/utils/infrastructure/postgres-error.util.js', () => ({
  runInsertWithPublicIdentifierRetry: async (operation: () => Promise<unknown>) => operation(),
}));

vi.mock('@/shared/utils/identity/public-id.util.js', () => ({
  generatePublicId: () => 'role_public_test',
}));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
}));

describe('MemberRoleRepository', () => {
  const repository = new MemberRoleRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockReset();
    mockOffset.mockReset();
    /** Default count chain returns 0 rows. Tests override per assertion. */
    countAwaitable.then = (resolve: (value: Array<{ count: number }>) => void) =>
      resolve([{ count: 0 }]);
    mockSelect.mockImplementation(() => ({ from: mockFromRows }));
  });

  it('findByOrganizationId returns empty page when no rows', async () => {
    mockOffset.mockResolvedValue([]);
    mockSelect
      .mockImplementationOnce(() => ({ from: mockFromRows }))
      .mockImplementationOnce(() => ({ from: mockCountFrom }));

    const result = await repository.findByOrganizationId(1, 1, 20);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('findByOrganizationId returns paginated roles', async () => {
    const rows = [
      {
        public_id: 'role_1',
        name: 'Admin',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        id: 1,
      },
    ];
    mockOffset.mockResolvedValue(rows);
    countAwaitable.then = (resolve: (value: Array<{ count: number }>) => void) =>
      resolve([{ count: 1 }]);
    mockSelect
      .mockImplementationOnce(() => ({ from: mockFromRows }))
      .mockImplementationOnce(() => ({ from: mockCountFrom }));

    const result = await repository.findByOrganizationId(1, 1, 20);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.total_pages).toBe(1);
  });

  it('findByPublicId returns null when role is missing', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    });

    const result = await repository.findByPublicId('missing', 1);

    expect(result).toBeNull();
  });

  it('update and softDelete return null when role is missing', async () => {
    mockReturning.mockResolvedValue([]);

    expect(await repository.update('missing', 1, { name: 'X' }, 9)).toBeNull();
    expect(await repository.softDelete('missing', 1)).toBeNull();
  });

  it('create inserts role with explicit is_system false', async () => {
    const created = { public_id: 'role_public_test', is_system: false };
    mockReturning.mockResolvedValue([created]);

    const result = await repository.create({
      organization_id: 1,
      name: 'Custom',
      is_system: false,
    });

    expect(result).toEqual(created);
  });
});
