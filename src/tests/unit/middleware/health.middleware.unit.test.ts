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

// Mutable opt-in flags so each test can toggle the EX-03 readiness thresholds (default off).
const mockReadyzOptIn = vi.hoisted(() => ({
  on503OpenCircuit: false,
  queueDepthThreshold: 0,
}));

vi.mock('@/shared/utils/infrastructure/health-operational-metrics.util.js', () => ({
  getCachedHealthOperationalMetrics: vi.fn().mockResolvedValue({
    migration_version: '20260501000000_test.sql',
    mail_outbox_pending: 0,
    dlq_depth: 0,
    draining: false,
    worker_queues: [],
    worker_queue_manifest: [],
    circuit_breakers: [],
    queue_depths: [],
    degraded: false,
  }),
}));

// sec-C4: tests assert the verbose-body shape. Default for new env var is
// false; enable it in this suite so the existing assertions continue to
// exercise the operational-metrics surface (which is still the path that
// runs on operator-opted internal probes).
vi.mock('@/shared/config/env.config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/shared/config/env.config.js')>();
  return {
    ...original,
    env: {
      ...original.env,
      HEALTH_VERBOSE_BODY_ENABLED: true,
      get READYZ_503_ON_OPEN_CIRCUIT() {
        return mockReadyzOptIn.on503OpenCircuit;
      },
      get READYZ_QUEUE_DEPTH_503_THRESHOLD() {
        return mockReadyzOptIn.queueDepthThreshold;
      },
    },
  };
});

vi.mock('@/shared/utils/infrastructure/readiness-probes.util.js', () => ({
  getCachedDependencyReadinessProbes: vi.fn().mockResolvedValue({
    status: 'ok',
    database: 'connected',
    redis: 'connected',
    bullmq: 'connected',
    latencyMs: { database: 1, redis: 1, bullmq: 1 },
  }),
}));

import healthMiddleware from '@/shared/middlewares/core/health.middleware.js';
import { isApplicationDraining } from '@/shared/utils/infrastructure/application-lifecycle.util.js';
import { getCachedDependencyReadinessProbes } from '@/shared/utils/infrastructure/readiness-probes.util.js';
import { getCachedHealthOperationalMetrics } from '@/shared/utils/infrastructure/health-operational-metrics.util.js';

describe('health.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    vi.clearAllMocks();
    mockReadyzOptIn.on503OpenCircuit = false;
    mockReadyzOptIn.queueDepthThreshold = 0;
    vi.mocked(isApplicationDraining).mockReturnValue(false);
    vi.mocked(getCachedDependencyReadinessProbes).mockResolvedValue({
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

  it('returns liveness ok at GET /livez without running dependency probes', async () => {
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/livez' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(getCachedDependencyReadinessProbes).not.toHaveBeenCalled();
  });

  it('returns 503 draining at GET /livez when application is shutting down', async () => {
    vi.mocked(isApplicationDraining).mockReturnValue(true);
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/livez' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'draining' });
    expect(getCachedDependencyReadinessProbes).not.toHaveBeenCalled();
  });

  it('returns readiness payload at GET /readyz', async () => {
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
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
    expect(getCachedDependencyReadinessProbes).toHaveBeenCalledTimes(1);
  });

  it('returns 503 at GET /readyz when a dependency probe fails', async () => {
    vi.mocked(getCachedDependencyReadinessProbes).mockResolvedValueOnce({
      status: 'error',
      database: 'connected',
      redis: 'unavailable',
      bullmq: 'connected',
      latencyMs: { database: 1, redis: null, bullmq: 1 },
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().redis).toBe('unavailable');
  });

  it('returns 503 at GET /readyz when the bullmq probe fails', async () => {
    vi.mocked(getCachedDependencyReadinessProbes).mockResolvedValueOnce({
      status: 'error',
      database: 'connected',
      redis: 'connected',
      bullmq: 'unavailable',
      latencyMs: { database: 1, redis: 1, bullmq: null },
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().bullmq).toBe('unavailable');
  });

  it('does not set deprecation headers on GET /readyz', async () => {
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.headers.sunset).toBeUndefined();
  });

  it('EX-03: surfaces breaker state + queue depth as degraded but stays 200 when opt-in 503 is off', async () => {
    vi.mocked(getCachedHealthOperationalMetrics).mockResolvedValueOnce({
      migration_version: '20260501000000_test.sql',
      mail_outbox_pending: 0,
      dlq_depth: 0,
      draining: false,
      worker_queues: [],
      worker_queue_manifest: [],
      circuit_breakers: [{ name: 'resend', state: 'OPEN' }],
      queue_depths: [{ queue: 'mail', waiting: 3, delayed: 0 }],
      degraded: true,
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      degraded: true,
      circuit_breakers: [{ name: 'resend', state: 'OPEN' }],
      queue_depths: [{ queue: 'mail', waiting: 3, delayed: 0 }],
    });
  });

  it('EX-03: returns 503 when READYZ_503_ON_OPEN_CIRCUIT is enabled and a breaker is OPEN', async () => {
    mockReadyzOptIn.on503OpenCircuit = true;
    vi.mocked(getCachedHealthOperationalMetrics).mockResolvedValueOnce({
      migration_version: null,
      mail_outbox_pending: 0,
      dlq_depth: 0,
      draining: false,
      worker_queues: [],
      worker_queue_manifest: [],
      circuit_breakers: [{ name: 'resend', state: 'OPEN' }],
      queue_depths: [],
      degraded: true,
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().degraded).toBe(true);
  });

  it('EX-03: returns 503 when a throughput queue exceeds READYZ_QUEUE_DEPTH_503_THRESHOLD', async () => {
    mockReadyzOptIn.queueDepthThreshold = 100;
    vi.mocked(getCachedHealthOperationalMetrics).mockResolvedValueOnce({
      migration_version: null,
      mail_outbox_pending: 0,
      dlq_depth: 0,
      draining: false,
      worker_queues: [],
      worker_queue_manifest: [],
      circuit_breakers: [],
      queue_depths: [{ queue: 'webhook-delivery', waiting: 250, delayed: 0 }],
      degraded: false,
    });
    application = Fastify();
    await application.register(healthMiddleware);
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
  });
});
