import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getEnvMock } = vi.hoisted(() => {
  const getEnvMock = vi.fn<() => Record<string, unknown>>(() => ({
    LOG_LEVEL: 'silent',
  }));
  return { getEnvMock };
});

vi.mock('@/shared/config/env.config.js', () => ({
  env: new Proxy(
    {},
    {
      get(_target, property) {
        return getEnvMock()[property as string];
      },
    },
  ),
  getEnv: () => getEnvMock(),
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
}));

type MockedDefinition = {
  queueName: string;
  family: string;
  logLabel: string;
  usesPostgres: boolean;
  scheduled: boolean;
  criticality: 'throughput' | 'maintenance' | 'observability';
  create: () => { close: () => Promise<void> };
};

const REGISTRY_FIXTURE: MockedDefinition[] = [];
const SCHEDULED_QUEUE_FIXTURE: { queueName: string }[] = [];

vi.mock('@/infrastructure/queue/worker-runtime/worker-registration.registry.js', () => ({
  getWorkerQueueRegistrationDefinitions: () => REGISTRY_FIXTURE,
}));

vi.mock('@/infrastructure/queue/scheduler.js', () => ({
  getScheduledJobs: () => SCHEDULED_QUEUE_FIXTURE,
}));

import { detectSchedulerRegistryMismatches } from '@/infrastructure/queue/worker-runtime/scheduler-registry-audit.js';

function pushDefinition(definition: MockedDefinition): void {
  REGISTRY_FIXTURE.push(definition);
}

function pushScheduledJob(queueName: string): void {
  SCHEDULED_QUEUE_FIXTURE.push({ queueName });
}

describe('detectSchedulerRegistryMismatches', () => {
  beforeEach(() => {
    REGISTRY_FIXTURE.length = 0;
    SCHEDULED_QUEUE_FIXTURE.length = 0;
  });

  afterEach(() => {
    REGISTRY_FIXTURE.length = 0;
    SCHEDULED_QUEUE_FIXTURE.length = 0;
  });

  it('returns no mismatches when scheduled flags match cron list', () => {
    pushDefinition({
      queueName: 'audit-retention',
      family: 'retention',
      logLabel: 'audit retention worker',
      usesPostgres: true,
      scheduled: true,
      criticality: 'maintenance',
      create: () => ({ close: async () => {} }),
    });
    pushScheduledJob('audit-retention');

    expect(detectSchedulerRegistryMismatches()).toEqual([]);
  });

  it('flags scheduled=true with no cron (orphan worker)', () => {
    pushDefinition({
      queueName: 'partition-maintenance',
      family: 'retention',
      logLabel: 'partition maintenance worker',
      usesPostgres: true,
      scheduled: true,
      criticality: 'maintenance',
      create: () => ({ close: async () => {} }),
    });

    expect(detectSchedulerRegistryMismatches()).toEqual([
      { queueName: 'partition-maintenance', issue: 'scheduled_flag_without_cron' },
    ]);
  });

  it('flags cron with no scheduled=true (stale scheduler entry)', () => {
    pushDefinition({
      queueName: 'mail',
      family: 'mail',
      logLabel: 'mail worker',
      usesPostgres: true,
      scheduled: false,
      criticality: 'throughput',
      create: () => ({ close: async () => {} }),
    });
    pushScheduledJob('mail');

    expect(detectSchedulerRegistryMismatches()).toEqual([
      { queueName: 'mail', issue: 'cron_without_scheduled_flag' },
    ]);
  });

  it('event-driven workers with scheduled=false and no cron are not flagged', () => {
    pushDefinition({
      queueName: 'mail',
      family: 'mail',
      logLabel: 'mail worker',
      usesPostgres: true,
      scheduled: false,
      criticality: 'throughput',
      create: () => ({ close: async () => {} }),
    });

    expect(detectSchedulerRegistryMismatches()).toEqual([]);
  });
});
