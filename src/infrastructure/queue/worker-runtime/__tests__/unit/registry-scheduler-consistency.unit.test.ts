import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/config/env.config.js', () => ({
  env: new Proxy(
    {
      LOG_LEVEL: 'silent',
      SCHEDULER_ENABLED: true,
      WORKER_CONCURRENCY: 4,
      WORKER_CONCURRENCY_MAIL: 4,
      WORKER_CONCURRENCY_NOTIFY: 4,
      WORKER_CONCURRENCY_WEBHOOK: 4,
      WORKER_CONCURRENCY_STRIPE: 4,
    },
    {
      get(target, property: string) {
        return property in target ? target[property as keyof typeof target] : undefined;
      },
    },
  ),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/infrastructure/database/connection.js', () => ({
  sql: vi.fn(),
  database: {},
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redis: {},
  redisConnection: {},
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
  Queue: vi.fn(),
}));

import {
  detectSchedulerRegistryMismatches,
  findMaintenanceWorkersWithoutSchedule,
} from '@/infrastructure/queue/worker-runtime/scheduler-registry-audit.js';

describe('registry ⊆ scheduler consistency (real registry + scheduler)', () => {
  it('every maintenance worker has a matching scheduler.ts cron entry', () => {
    expect(findMaintenanceWorkersWithoutSchedule()).toEqual([]);
  });

  it('has no scheduled-flag / cron drift between the registry and scheduler', () => {
    expect(detectSchedulerRegistryMismatches()).toEqual([]);
  });
});
