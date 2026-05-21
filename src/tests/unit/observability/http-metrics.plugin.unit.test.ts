import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { resetMetricsRegistryForTests } from '@/infrastructure/observability/metrics/metrics-registry.js';

describe('http-metrics.plugin', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;

  beforeEach(() => {
    vi.resetModules();
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.resetModules();
    if (originalMetricsEnabled === undefined) {
      delete process.env.METRICS_ENABLED;
    } else {
      process.env.METRICS_ENABLED = originalMetricsEnabled;
    }
    resetEnvCacheForTests();
    resetMetricsRegistryForTests();
  });

  it('exports RED counters after recordHttpRequest', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();

    const { recordHttpRequest } =
      await import('@/infrastructure/observability/metrics/prometheus-metrics.js');
    const { renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js');

    recordHttpRequest('GET', '/direct', 200, 0.01);
    const metricsBody = await renderMetrics();
    expect(metricsBody).toMatch(/method="GET"/);
    expect(metricsBody).toMatch(/route="\/direct"/);
    expect(metricsBody).toMatch(/status_code="200"/);
  });

  it('increments RED counters for a registered route when METRICS_ENABLED is true', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();

    const { isMetricsEnabled } = await import('@/infrastructure/observability/metrics/metrics.js');
    expect(isMetricsEnabled()).toBe(true);

    const { default: httpMetricsPlugin } =
      await import('@/infrastructure/observability/metrics/http-metrics.plugin.js');
    const { renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js');

    const application = Fastify();
    await application.register(httpMetricsPlugin);
    application.get('/probe', async () => ({ ok: true }));
    await application.ready();

    const probeResponse = await application.inject({ method: 'GET', url: '/probe' });
    expect(probeResponse.statusCode).toBe(200);

    const metricsBody = await renderMetrics();
    expect(metricsBody).toMatch(/method="GET"/);
    expect(metricsBody).toMatch(/route="\/probe"/);
    expect(metricsBody).toMatch(/status_code="200"/);

    await application.close();
  });
});
