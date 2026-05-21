import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { stopPostgresPoolMetricsPolling } from '@/infrastructure/observability/metrics/db-pool-metrics.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';

describe('db-pool-metrics integration', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;
  let application: FastifyInstance;

  beforeAll(async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();
    const { createTestApp } = await import('@/tests/helpers/test-app.js');
    const testApplication = await createTestApp();
    application = testApplication.app;
  });

  afterAll(async () => {
    stopPostgresPoolMetricsPolling();
    if (application) {
      await application.close();
    }
    if (originalMetricsEnabled === undefined) {
      delete process.env.METRICS_ENABLED;
    } else {
      process.env.METRICS_ENABLED = originalMetricsEnabled;
    }
    resetEnvCacheForTests();
  });

  it('GET /metrics exposes db_pool_connections active, idle, and waiting gauges', async () => {
    const response = await injectUnauthenticated(application, {
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;

    expect(body).toContain('postgres_pool_metrics_available 1');
    expect(body).toMatch(/db_pool_connections\{state="active"[^}]*\} \d+/);
    expect(body).toMatch(/db_pool_connections\{state="idle"[^}]*\} \d+/);
    expect(body).toMatch(/db_pool_connections\{state="waiting"[^}]*\} \d+/);
    expect(body).toContain('# TYPE pg_pool_active gauge');
    expect(body).toContain('pg_pool_active{');
    expect(body).toContain('pg_pool_idle{');
    expect(body).toContain('pg_pool_waiting{');
  }, 15_000);
});
