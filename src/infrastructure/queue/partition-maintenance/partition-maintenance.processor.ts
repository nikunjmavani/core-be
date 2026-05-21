import { runPartitionMaintenance } from '@/infrastructure/database/partition-maintenance.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

export async function runPartitionMaintenanceJob(): Promise<{ ensured: number; dropped: number }> {
  logger.info('partition-maintenance.starting');
  const result = await runPartitionMaintenance();
  logger.info(result, 'partition-maintenance.completed');
  return result;
}
