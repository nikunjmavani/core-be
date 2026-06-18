import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import {
  markWorkerHealthNotReady,
  markWorkerHealthReady,
  startWorkerHealthServer,
  stopWorkerHealthServer,
} from '@/infrastructure/queue/worker-runtime/worker-health.server.js';
import { env, resetEnvCacheForTests } from '@/shared/config/env.config.js';
import type * as MetricsModule from '@/infrastructure/observability/metrics/metrics.js';
import type * as WorkerQueueHeartbeatModule from '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js';
import type * as BullmqMetricsModule from '@/infrastructure/observability/metrics/bullmq-metrics.js';

vi.mock(
  '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js',
  async (importOriginal) => {
    const actual = await importOriginal<typeof WorkerQueueHeartbeatModule>();
    return {
      ...actual,
      readWorkerQueueHeartbeats: vi.fn().mockResolvedValue([]),
    };
  },
);

vi.mock('@/infrastructure/observability/metrics/bullmq-metrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof BullmqMetricsModule>();
  return {
    ...actual,
    // Default: no pending work, so the readiness probe never reads Redis in unit tests.
    readQueuesPendingWorkTotal: vi.fn().mockResolvedValue(0),
  };
});

vi.mock('@/infrastructure/observability/metrics/metrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof MetricsModule>();
  return {
    ...actual,
    refreshMetricsBeforeScrape: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/shared/utils/infrastructure/readiness-probes.util.js', () => ({
  runDependencyReadinessProbes: vi.fn().mockResolvedValue({
    status: 'ok',
    database: 'connected',
    redis: 'connected',
    bullmq: 'connected',
    latencyMs: { database: 1, redis: 1, bullmq: 1 },
  }),
}));

function getHealth(
  url: string,
  options?: { authorization?: string },
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(
        url,
        { headers: options?.authorization ? { authorization: options.authorization } : {} },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      )
      .on('error', reject);
  });
}

describe('worker-health.server', () => {
  const host = env.HTTP_BIND_HOST === '0.0.0.0' ? '127.0.0.1' : env.HTTP_BIND_HOST;
  const baseUrl = `http://${host}:${env.WORKER_HEALTH_PORT}`;
  const liveUrl = `${baseUrl}/livez`;
  const readyUrl = `${baseUrl}/readyz`;
  const metricsUrl = `${baseUrl}/metrics`;

  beforeAll(async () => {
    markWorkerHealthNotReady();
    await startWorkerHealthServer();
  });

  afterAll(async () => {
    markWorkerHealthNotReady();
    await stopWorkerHealthServer();
  });

  it('returns 200 on /livez regardless of worker readiness', async () => {
    markWorkerHealthNotReady();
    const response = await getHealth(liveUrl);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'live', role: 'worker' });
  });

  it('returns 503 on /readyz before workers are marked ready', async () => {
    markWorkerHealthNotReady();
    const response = await getHealth(readyUrl);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'starting', role: 'worker' });
  });

  it('returns 200 on /readyz after workers are marked ready', async () => {
    markWorkerHealthReady(3);
    const response = await getHealth(readyUrl);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'ok',
      role: 'worker',
      workersRegistered: 3,
    });
  });

  it('returns 503 on /readyz when throughput heartbeats are stale and work is pending', async () => {
    const { readWorkerQueueHeartbeats } = await import(
      '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js'
    );
    const { readQueuesPendingWorkTotal } = await import(
      '@/infrastructure/observability/metrics/bullmq-metrics.js'
    );
    vi.mocked(readWorkerQueueHeartbeats)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          queue: 'mail',
          last_job_at: new Date(
            Date.now() - env.WORKER_HEALTH_STALL_TIMEOUT_MS - 1_000,
          ).toISOString(),
        },
      ]);
    // Pending work present → stale heartbeats are a genuine stall.
    vi.mocked(readQueuesPendingWorkTotal).mockResolvedValueOnce(5);
    markWorkerHealthReady(3);
    const response = await getHealth(readyUrl);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'stalled', role: 'worker' });
  });

  it('returns 200 on /readyz when heartbeats are stale but no work is pending (idle)', async () => {
    const { readWorkerQueueHeartbeats } = await import(
      '@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js'
    );
    const { readQueuesPendingWorkTotal } = await import(
      '@/infrastructure/observability/metrics/bullmq-metrics.js'
    );
    vi.mocked(readWorkerQueueHeartbeats)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          queue: 'mail',
          last_job_at: new Date(
            Date.now() - env.WORKER_HEALTH_STALL_TIMEOUT_MS - 1_000,
          ).toISOString(),
        },
      ]);
    // No pending work → idle worker must stay ready (no restart-loop false positive).
    vi.mocked(readQueuesPendingWorkTotal).mockResolvedValueOnce(0);
    markWorkerHealthReady(3);
    const response = await getHealth(readyUrl);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok', role: 'worker' });
  });

  it('returns 401 on /metrics without bearer token when METRICS_SCRAPE_TOKEN is set', async () => {
    vi.stubEnv('METRICS_ENABLED', 'true');
    vi.stubEnv('METRICS_SCRAPE_TOKEN', 'test-metrics-bearer-token-min-32-chars');
    resetEnvCacheForTests();
    markWorkerHealthReady(1);

    const response = await getHealth(metricsUrl);
    expect(response.statusCode).toBe(401);
  });

  it('returns Prometheus text on /metrics with valid bearer token', async () => {
    const bearerToken = 'test-metrics-bearer-token-min-32-chars';
    vi.stubEnv('METRICS_ENABLED', 'true');
    vi.stubEnv('METRICS_SCRAPE_TOKEN', bearerToken);
    resetEnvCacheForTests();
    markWorkerHealthReady(1);

    const response = await getHealth(metricsUrl, {
      authorization: `Bearer ${bearerToken}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('nodejs_');
  });
});
