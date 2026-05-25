import { beforeEach, describe, expect, it, vi } from 'vitest';

const runPartitionMaintenanceMock = vi.fn();

vi.mock('@/infrastructure/database/partition-maintenance.js', () => ({
  runPartitionMaintenance: runPartitionMaintenanceMock,
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('partition-maintenance.processor', () => {
  beforeEach(() => {
    runPartitionMaintenanceMock.mockReset();
    runPartitionMaintenanceMock.mockResolvedValue({ ensured: 6, dropped: 1 });
  });

  it('runPartitionMaintenanceJob ensures partitions then drops empty expired children', async () => {
    const { runPartitionMaintenanceJob } = await import(
      '@/infrastructure/queue/partition-maintenance/partition-maintenance.processor.js'
    );

    const result = await runPartitionMaintenanceJob();

    expect(runPartitionMaintenanceMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ ensured: 6, dropped: 1 });
  });
});
