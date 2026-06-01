import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';

describe('metrics.middleware', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;
  const originalMetricsBearer = process.env.METRICS_SCRAPE_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;
  const METRICS_TOKEN_FIXTURE = 'metrics-token-fixture-minimum-32-chars';

  beforeEach(() => {
    vi.resetModules();
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/shared/config/env.config.js');
    vi.doUnmock('@/infrastructure/observability/metrics/metrics.js');
    if (originalMetricsEnabled === undefined) {
      delete process.env.METRICS_ENABLED;
    } else {
      process.env.METRICS_ENABLED = originalMetricsEnabled;
    }
    if (originalMetricsBearer === undefined) {
      delete process.env.METRICS_SCRAPE_TOKEN;
    } else {
      process.env.METRICS_SCRAPE_TOKEN = originalMetricsBearer;
    }
    process.env.NODE_ENV = originalNodeEnv;
    resetEnvCacheForTests();
  });

  it('does not register /metrics when METRICS_ENABLED is false', async () => {
    process.env.METRICS_ENABLED = 'false';
    resetEnvCacheForTests();
    const { default: metricsMiddleware } = await import(
      '@/shared/middlewares/core/metrics.middleware.js'
    );
    const application = Fastify();
    await application.register(metricsMiddleware);
    const response = await application.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(404);
    await application.close();
  });

  it('requires bearer token whenever metrics are enabled', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();
    vi.doMock('@/shared/config/env.config.js', () => ({
      getEnv: () => ({
        METRICS_ENABLED: true,
        METRICS_SCRAPE_TOKEN: METRICS_TOKEN_FIXTURE,
      }),
      resetEnvCacheForTests: () => {},
    }));
    vi.doMock('@/infrastructure/observability/metrics/metrics.js', () => ({
      isMetricsEnabled: () => true,
      refreshMetricsBeforeScrape: async () => {},
      renderMetrics: () => 'process_cpu 1\n',
    }));
    const { default: metricsMiddleware } = await import(
      '@/shared/middlewares/core/metrics.middleware.js'
    );
    const application = Fastify();
    await application.register(metricsMiddleware);
    const unauthorized = await application.inject({ method: 'GET', url: '/metrics' });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await application.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN_FIXTURE}` },
    });
    expect(authorized.statusCode).toBe(200);
    await application.close();
  });

  it('returns Prometheus text when METRICS_ENABLED is true and bearer token is valid', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_SCRAPE_TOKEN = METRICS_TOKEN_FIXTURE;
    resetEnvCacheForTests();
    vi.doMock('@/infrastructure/observability/metrics/metrics.js', () => ({
      isMetricsEnabled: () => true,
      refreshMetricsBeforeScrape: async () => {},
      renderMetrics: async () => 'process_cpu 1\n',
    }));
    const { default: metricsMiddleware } = await import(
      '@/shared/middlewares/core/metrics.middleware.js'
    );
    const application = Fastify();
    await application.register(metricsMiddleware);
    const response = await application.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${METRICS_TOKEN_FIXTURE}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('process_cpu');
    await application.close();
  });
});
