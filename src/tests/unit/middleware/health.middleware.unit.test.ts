import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/database/connection.js', () => ({
  sql: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    ping: vi.fn().mockResolvedValue('PONG'),
  },
}));

vi.mock('@/infrastructure/queue/health.js', () => ({
  pingBullMQ: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/utils/infrastructure/application-lifecycle.util.js', () => ({
  isApplicationDraining: vi.fn().mockReturnValue(false),
}));

vi.mock('@/shared/utils/infrastructure/health-operational-metrics.util.js', () => ({
  getCachedHealthOperationalMetrics: vi.fn().mockResolvedValue({
    migration_version: '20260501000000_test.sql',
    mail_outbox_pending: 0,
    dlq_depth: 0,
    draining: false,
    worker_queues: [],
  }),
}));

vi.mock('@/shared/utils/infrastructure/readiness-probes.util.js', () => ({
  runDependencyReadinessProbes: vi.fn().mockResolvedValue({
    status: 'ok',
    database: 'connected',
    redis: 'connected',
    bullmq: 'connected',
    latencyMs: { database: 1, redis: 1, bullmq: 1 },
  }),
}));

import healthMiddleware from '@/shared/middlewares/health.middleware.js';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { runDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';

describe('health.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    vi.clearAllMocks();
    vi.mocked(isApplicationDraining).mockReturnValue(false);
    vi.mocked(runDependencyReadinessProbes).mockResolvedValue({
      status: 'ok',
      database: 'connected',
      redis: 'connected',
      bullmq: 'connected',
      latencyMs: { database: 1, redis: 1, bullmq: 1 },
    });
    if (application) {
      await application.close();
    }
  });

  it('returns readiness payload at GET /health', async () => {
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'connected',
      redis: 'connected',
      bullmq: 'connected',
      migration_version: '20260501000000_test.sql',
      mail_outbox_pending: 0,
      dlq_depth: 0,
      draining: false,
      worker_queues: [],
    });
  });

  it('returns ok when all readiness dependencies succeed', async () => {
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.json().database).toBe('connected');
    expect(response.json().migration_version).toBe('20260501000000_test.sql');
    expect(response.json().mail_outbox_pending).toBe(0);
    expect(response.json().dlq_depth).toBe(0);
  });

  it('returns draining status when application is shutting down', async () => {
    vi.mocked(isApplicationDraining).mockReturnValue(true);
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('draining');
  });

  it('returns 503 when redis ping response is unexpected', async () => {
    vi.mocked(runDependencyReadinessProbes).mockResolvedValueOnce({
      status: 'error',
      database: 'connected',
      redis: 'unavailable',
      bullmq: 'connected',
      latencyMs: { database: 1, redis: null, bullmq: 1 },
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().redis).toBe('unavailable');
  });

  it('returns 503 when bullmq probe fails', async () => {
    vi.mocked(runDependencyReadinessProbes).mockResolvedValueOnce({
      status: 'error',
      database: 'connected',
      redis: 'connected',
      bullmq: 'unavailable',
      latencyMs: { database: 1, redis: 1, bullmq: null },
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().bullmq).toBe('unavailable');
  });

  it('does not set deprecation headers on canonical GET /health', async () => {
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.headers.sunset).toBeUndefined();
  });
});
