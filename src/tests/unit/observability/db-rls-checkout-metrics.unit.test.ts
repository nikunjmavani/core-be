import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { resetMetricsRegistryForTests } from '@/infrastructure/observability/metrics/metrics-registry.js';

describe('database_rls_* checkout metrics', () => {
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

  it('exports the hold-time histogram (labelled by path) and the active-checkout gauge', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();

    const { getMetricsRegistry } = await import(
      '@/infrastructure/observability/metrics/metrics-registry.js'
    );
    const {
      ensurePrometheusMetricsRegistered,
      recordOrganizationRlsCheckoutHold,
      setOrganizationRlsActiveCheckouts,
    } = await import('@/infrastructure/observability/metrics/prometheus-metrics.js');
    const { renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js');

    ensurePrometheusMetricsRegistered(getMetricsRegistry());
    recordOrganizationRlsCheckoutHold({ path: 'scoped_context', durationSeconds: 0.02 });
    recordOrganizationRlsCheckoutHold({ path: 'request_transaction', durationSeconds: 0.2 });
    setOrganizationRlsActiveCheckouts(3);

    const metricsBody = await renderMetrics();
    expect(metricsBody).toMatch(
      /database_rls_checkout_hold_seconds_bucket\{[^}]*path="scoped_context"/,
    );
    expect(metricsBody).toMatch(
      /database_rls_checkout_hold_seconds_bucket\{[^}]*path="request_transaction"/,
    );
    expect(metricsBody).toMatch(/database_rls_active_checkouts(\{[^}]*\})? 3/);
  });
});
