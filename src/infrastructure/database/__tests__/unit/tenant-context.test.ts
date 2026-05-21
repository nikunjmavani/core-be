import { describe, expect, it, vi } from 'vitest';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-context.js';

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTransactionHandle = { execute: mockExecute, tag: 'transaction-handle' };

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    transaction: vi.fn(
      async (callback: (transaction: typeof mockTransactionHandle) => Promise<unknown>) =>
        callback(mockTransactionHandle),
    ),
  },
}));

describe('withOrganizationContext', () => {
  it('pins ALS so getRequestDatabase returns the same handle passed to the callback', async () => {
    await withOrganizationContext('org_public_test', async (databaseHandle) => {
      expect(getRequestDatabase()).toBe(databaseHandle);
      expect(databaseHandle).toBe(mockTransactionHandle);
    });

    expect(mockExecute).toHaveBeenCalled();
    expect(getRequestDatabase()).not.toBe(mockTransactionHandle);
  });
});
