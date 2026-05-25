import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEnvMock } = vi.hoisted(() => {
  const getEnvMock = vi.fn<() => Record<string, unknown>>(() => ({
    LOG_LEVEL: 'silent',
    WORKER_CONCURRENCY: 4,
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

vi.mock('@/infrastructure/mail/mail.service.js', () => ({
  isMailConfigured: () => true,
}));

vi.mock('@/infrastructure/payment/stripe.client.js', () => ({
  isStripeConfigured: () => true,
  isStripeWebhookIngressConfigured: () => true,
}));

type MockedDefinition = {
  queueName: string;
  family: string;
  logLabel: string;
  usesPostgres: boolean;
  scheduled: boolean;
  criticality: 'throughput' | 'maintenance' | 'observability';
  holdsConnectionDuringExternalIo?: boolean;
  resolvePostgresConcurrency?: () => number;
  isEnabled?: () => boolean;
  create: () => { close: () => Promise<void> };
};

const MOCK_DEFINITIONS: MockedDefinition[] = [
  {
    queueName: 'mail-outbox-sweeper',
    family: 'mail',
    logLabel: 'mail outbox sweeper',
    usesPostgres: true,
    scheduled: true,
    criticality: 'maintenance',
    resolvePostgresConcurrency: () => 1,
    create: () => ({ close: async () => {} }),
  },
  {
    queueName: 'mail',
    family: 'mail',
    logLabel: 'mail',
    usesPostgres: true,
    scheduled: false,
    criticality: 'throughput',
    holdsConnectionDuringExternalIo: false,
    resolvePostgresConcurrency: () => 2,
    isEnabled: () => true,
    create: () => ({ close: async () => {} }),
  },
  {
    queueName: 'webhook-delivery',
    family: 'webhook',
    logLabel: 'webhook',
    usesPostgres: true,
    scheduled: false,
    criticality: 'throughput',
    holdsConnectionDuringExternalIo: true,
    resolvePostgresConcurrency: () => 10,
    create: () => ({ close: async () => {} }),
  },
  {
    queueName: 'user-data-export',
    family: 'notify',
    logLabel: 'export',
    usesPostgres: true,
    scheduled: false,
    criticality: 'throughput',
    holdsConnectionDuringExternalIo: true,
    resolvePostgresConcurrency: () => 6,
    create: () => ({ close: async () => {} }),
  },
  {
    queueName: 'dlq-depth',
    family: 'observability',
    logLabel: 'dlq',
    usesPostgres: false,
    scheduled: true,
    criticality: 'observability',
    create: () => ({ close: async () => {} }),
  },
];

vi.mock('@/infrastructure/queue/worker-runtime/worker-registration.registry.js', () => ({
  getWorkerQueueRegistrationDefinitions: () => MOCK_DEFINITIONS,
  getWorkerRegistrationsForFamilies: (families: string[]) => {
    const familySet = new Set(families);
    return MOCK_DEFINITIONS.filter((definition) => familySet.has(definition.family));
  },
}));

import {
  computeWorkerPostgresPoolDemand,
  resolveActiveWorkerQueueNames,
} from '@/infrastructure/queue/worker-runtime/worker-connection-budget.js';

describe('worker-connection-budget', () => {
  beforeEach(() => {
    getEnvMock.mockReset();
    getEnvMock.mockReturnValue({ LOG_LEVEL: 'silent', WORKER_CONCURRENCY: 4 });
  });

  it('sums postgres concurrency for all families when WORKER_QUEUE_FAMILIES is unset', () => {
    const report = computeWorkerPostgresPoolDemand();
    expect(report.monolithicWorker).toBe(true);
    expect(report.peakPostgresConcurrency).toBe(19);
  });

  it('reports peakPostgresConcurrencyHoldingExternalIo for risky workers only', () => {
    const report = computeWorkerPostgresPoolDemand();
    expect(report.peakPostgresConcurrencyHoldingExternalIo).toBe(16);
  });

  it('limits demand to selected families', () => {
    getEnvMock.mockReturnValue({
      LOG_LEVEL: 'silent',
      WORKER_QUEUE_FAMILIES: 'mail,webhook',
      WORKER_CONCURRENCY: 4,
    });

    const report = computeWorkerPostgresPoolDemand();
    expect(report.monolithicWorker).toBe(false);
    expect(report.selectedFamilies).toEqual(['mail', 'webhook']);
    expect(report.peakPostgresConcurrency).toBe(13);
    expect(report.peakPostgresConcurrencyHoldingExternalIo).toBe(10);
  });

  it('emits criticality + external-io flag per queue entry', () => {
    const report = computeWorkerPostgresPoolDemand();
    const webhookEntry = report.queues.find((entry) => entry.queueName === 'webhook-delivery');
    expect(webhookEntry?.criticality).toBe('throughput');
    expect(webhookEntry?.holdsConnectionDuringExternalIo).toBe(true);

    const observabilityEntry = report.queues.find((entry) => entry.queueName === 'dlq-depth');
    expect(observabilityEntry?.criticality).toBe('observability');
    expect(observabilityEntry?.holdsConnectionDuringExternalIo).toBe(false);
  });

  it('resolveActiveWorkerQueueNames includes non-postgres observability queues', () => {
    getEnvMock.mockReturnValue({
      LOG_LEVEL: 'silent',
      WORKER_QUEUE_FAMILIES: 'observability',
    });

    expect(resolveActiveWorkerQueueNames()).toEqual(new Set(['dlq-depth']));
  });
});
