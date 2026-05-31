import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/config/env.config.js', () => ({
  env: new Proxy(
    {
      LOG_LEVEL: 'silent',
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

import { getWorkerQueueRegistrationDefinitions } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import { WORKER_QUEUE_FAMILY_NAMES } from '@/infrastructure/queue/worker-runtime/worker-queue-family.constants.js';

describe('worker-registration.registry', () => {
  it('keeps complete metadata for every registered worker', () => {
    const definitions = getWorkerQueueRegistrationDefinitions();

    expect(definitions).toHaveLength(26);
    for (const definition of definitions) {
      expect(definition.queueName).toBeTruthy();
      expect(definition.logLabel).toBeTruthy();
      expect(WORKER_QUEUE_FAMILY_NAMES).toContain(definition.family);
      expect(typeof definition.usesPostgres).toBe('boolean');
      expect(typeof definition.scheduled).toBe('boolean');
      expect(['throughput', 'maintenance', 'observability']).toContain(definition.criticality);
      expect(typeof definition.create).toBe('function');

      if (definition.usesPostgres) {
        expect(definition.resolvePostgresConcurrency).toEqual(expect.any(Function));
      } else {
        expect(definition.resolvePostgresConcurrency).toBeUndefined();
        expect(definition.holdsConnectionDuringExternalIo).not.toBe(true);
      }
    }
  });

  it('keeps expected family, criticality, scheduler, and external-io counts', () => {
    const definitions = getWorkerQueueRegistrationDefinitions();

    expect(definitions.filter((definition) => definition.usesPostgres)).toHaveLength(23);
    expect(definitions.filter((definition) => definition.scheduled)).toHaveLength(21);
    expect(
      definitions.filter((definition) => definition.criticality === 'throughput'),
    ).toHaveLength(5);
    expect(
      definitions.filter((definition) => definition.criticality === 'maintenance'),
    ).toHaveLength(19);
    expect(
      definitions.filter((definition) => definition.criticality === 'observability'),
    ).toHaveLength(2);
    expect(
      definitions.filter((definition) => definition.holdsConnectionDuringExternalIo === true),
    ).toHaveLength(5);
  });

  it('has no maintenance workers left unscheduled (every retention worker has a cron)', () => {
    const orphanQueueNames = getWorkerQueueRegistrationDefinitions()
      .filter(
        (definition) => definition.criticality === 'maintenance' && definition.scheduled === false,
      )
      .map((definition) => definition.queueName)
      .sort();

    expect(orphanQueueNames).toEqual([]);
  });
});
