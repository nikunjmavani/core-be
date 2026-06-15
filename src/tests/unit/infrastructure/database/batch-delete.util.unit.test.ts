import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const deleteWhereMock = vi.fn();
const selectMock = vi.fn();
const databaseHandle = {
  select: selectMock,
  delete: () => ({
    where: deleteWhereMock,
  }),
};

import { deleteInBatchesByCondition } from '@/infrastructure/database/utils/batch-delete.util.js';

describe('deleteInBatchesByCondition', () => {
  it('returns deleted and blocked counts when per-row FK failures occur', async () => {
    const fakeTable = { id: 'fake_table' } as never;
    const fakeIdColumn = { name: 'id' } as never;

    selectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [{ id: 1 }, { id: 2 }],
          }),
        }),
      }),
    });

    const fkError = Object.assign(new Error('fk'), { code: '23503' });
    deleteWhereMock
      .mockRejectedValueOnce(fkError)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(fkError);

    const result = await deleteInBatchesByCondition({
      databaseHandle: databaseHandle as never,
      table: fakeTable,
      idColumn: fakeIdColumn,
      whereCondition: eq(fakeIdColumn, 1),
      logContext: 'test',
      tableLabel: 'fake',
    });

    expect(result).toEqual({ deletedCount: 1, blockedCount: 1 });
  });
});
