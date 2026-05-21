import { describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn().mockResolvedValue(undefined);
const transactionMock = vi.fn();

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    transaction: (...arguments_: unknown[]) => transactionMock(...arguments_),
  },
}));

import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';

describe('withGlobalRetentionCleanupDatabaseContext', () => {
  it('sets app.global_retention_cleanup and passes transaction handle to callback', async () => {
    const callback = vi.fn().mockResolvedValue('ok');
    const databaseHandle = { execute: executeMock };

    transactionMock.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) => callback(databaseHandle),
    );

    const result = await withGlobalRetentionCleanupDatabaseContext(callback);

    expect(result).toBe('ok');
    expect(executeMock).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(databaseHandle);
  });
});
