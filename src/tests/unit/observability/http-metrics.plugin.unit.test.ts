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

    const { recordHttpRequest } = await import(
      '@/infrastructure/observability/metrics/prometheus-metrics.js'
    );
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

    const { default: httpMetricsPlugin } = await import(
      '@/infrastructure/observability/metrics/http-metrics.plugin.js'
    );
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

  /**
   * Regression for sec-C2 (High): unmatched routes (404s) used to record the raw URL path
   * as the Prometheus `route` label, so any anonymous attacker could balloon the metrics
   * registry by requesting unique paths. Unbounded label cardinality eventually OOMs the
   * `/metrics` scrape, blinding ops. We now record under a single sentinel label.
   */
  it('records unmatched 404s under a single sentinel label, not the raw URL path (sec-C2)', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();

    const { default: httpMetricsPlugin } = await import(
      '@/infrastructure/observability/metrics/http-metrics.plugin.js'
    );
    const { renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js');

    const application = Fastify();
    await application.register(httpMetricsPlugin);
    await application.ready();

    const responses = await Promise.all([
      application.inject({ method: 'GET', url: '/random/path-aaaaaaaa' }),
      application.inject({ method: 'GET', url: '/random/path-bbbbbbbb' }),
      application.inject({ method: 'GET', url: '/random/path-cccccccc' }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
    }

    const metricsBody = await renderMetrics();

    // No raw-URL label leakage — the sentinel collapses every unmatched URL into one series.
    expect(metricsBody).not.toMatch(/route="\/random\/path-aaaaaaaa"/);
    expect(metricsBody).not.toMatch(/route="\/random\/path-bbbbbbbb"/);
    expect(metricsBody).not.toMatch(/route="\/random\/path-cccccccc"/);

    // The bounded sentinel IS present, with one counter row reflecting all three 404s.
    expect(metricsBody).toMatch(/route="__unmatched__"/);
    const counterMatch = metricsBody.match(
      /http_requests_total\{[^}]*route="__unmatched__"[^}]*status_code="404"[^}]*\}\s+(\d+)/,
    );
    expect(counterMatch).not.toBeNull();
    if (counterMatch) {
      expect(Number(counterMatch[1])).toBe(3);
    }

    await application.close();
  });
});
