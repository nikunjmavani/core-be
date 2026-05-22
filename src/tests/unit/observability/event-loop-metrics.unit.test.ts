import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { resetMetricsRegistryForTests } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { resetEventLoopMetricsForTests } from '@/infrastructure/observability/metrics/event-loop-metrics.js';

describe('event-loop-metrics', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;

  beforeEach(() => {
    vi.resetModules();
    resetEnvCacheForTests();
    resetMetricsRegistryForTests();
    resetEventLoopMetricsForTests();
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
    resetEventLoopMetricsForTests();
  });

  it('does not export event_loop_lag_ms when METRICS_ENABLED is false', async () => {
    process.env.METRICS_ENABLED = 'false';
    resetEnvCacheForTests();

    const { refreshEventLoopMetrics } =
      await import('@/infrastructure/observability/metrics/event-loop-metrics.js');
    const { renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js');

    refreshEventLoopMetrics();
    const metricsBody = await renderMetrics();
    expect(metricsBody).not.toContain('event_loop_lag_ms');
  });

  it('exports event_loop_lag_ms after refresh when METRICS_ENABLED is true', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();

    const { registerEventLoopMetrics, refreshEventLoopMetrics } =
      await import('@/infrastructure/observability/metrics/event-loop-metrics.js');
    const { renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js');

    /** Use the focused refresh — `refreshMetricsBeforeScrape()` also fans out to BullMQ
     * queue gauges and Postgres pool metrics, which connect to real infra and would hang
     * this unit test under parallel forks. We only need the event-loop slice here. */
    registerEventLoopMetrics();
    refreshEventLoopMetrics();

    const metricsBody = await renderMetrics();
    expect(metricsBody).toContain('# TYPE event_loop_lag_ms gauge');
    expect(metricsBody).toContain('event_loop_lag_ms{');
  });
});
