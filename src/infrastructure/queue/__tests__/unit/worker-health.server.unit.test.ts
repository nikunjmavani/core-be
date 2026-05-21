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

vi.mock('@/infrastructure/observability/metrics/metrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof MetricsModule>();
  return {
    ...actual,
    refreshMetricsBeforeScrape: vi.fn().mockResolvedValue(undefined),
  };
});

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
  const host = env.HOST === '0.0.0.0' ? '127.0.0.1' : env.HOST;
  const baseUrl = `http://${host}:${env.WORKER_HEALTH_PORT}`;
  const liveUrl = `${baseUrl}/health/live`;
  const metricsUrl = `${baseUrl}/metrics`;

  beforeAll(async () => {
    markWorkerHealthNotReady();
    await startWorkerHealthServer();
  });

  afterAll(async () => {
    markWorkerHealthNotReady();
    await stopWorkerHealthServer();
  });

  it('returns 503 on /health/live before workers are marked ready', async () => {
    markWorkerHealthNotReady();
    const response = await getHealth(liveUrl);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'starting', service: 'worker' });
  });

  it('returns 200 on /health/live after workers are marked ready', async () => {
    markWorkerHealthReady(3);
    const response = await getHealth(liveUrl);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok', service: 'worker' });
  });

  it('returns 503 on /health/live when throughput heartbeats are stale', async () => {
    const { readWorkerQueueHeartbeats } =
      await import('@/infrastructure/queue/worker-runtime/worker-queue-heartbeat.js');
    vi.mocked(readWorkerQueueHeartbeats).mockResolvedValueOnce([
      {
        queue: 'mail',
        last_job_at: new Date(
          Date.now() - env.WORKER_HEALTH_STALL_TIMEOUT_MS - 1_000,
        ).toISOString(),
      },
    ]);
    markWorkerHealthReady(3);
    const response = await getHealth(liveUrl);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'stalled', service: 'worker' });
  });

  it('returns 401 on /metrics without bearer token when METRICS_BEARER_TOKEN is set', async () => {
    vi.stubEnv('METRICS_ENABLED', 'true');
    vi.stubEnv('METRICS_BEARER_TOKEN', 'test-metrics-bearer-token-min-32-chars');
    resetEnvCacheForTests();
    markWorkerHealthReady(1);

    const response = await getHealth(metricsUrl);
    expect(response.statusCode).toBe(401);
  });

  it('returns Prometheus text on /metrics with valid bearer token', async () => {
    const bearerToken = 'test-metrics-bearer-token-min-32-chars';
    vi.stubEnv('METRICS_ENABLED', 'true');
    vi.stubEnv('METRICS_BEARER_TOKEN', bearerToken);
    resetEnvCacheForTests();
    markWorkerHealthReady(1);

    const response = await getHealth(metricsUrl, {
      authorization: `Bearer ${bearerToken}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('nodejs_');
  });
});
