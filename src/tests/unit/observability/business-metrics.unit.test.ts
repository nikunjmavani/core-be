import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMetricsRegistryForTests } from '@/infrastructure/observability/metrics/metrics-registry.js';

vi.mock('@/infrastructure/mail/mail-outbox.repository.js', () => ({
  countPendingMailOutbox: vi.fn().mockResolvedValue(3),
}));

vi.mock('@/infrastructure/observability/dlq-depth/dlq-depth.service.js', () => ({
  getTotalDeadLetterJobCount: vi.fn().mockResolvedValue(7),
}));

describe('business-metrics', () => {
  let refreshBusinessMetricsGauges: typeof import('@/infrastructure/observability/metrics/business-metrics.js').refreshBusinessMetricsGauges;
  let renderMetrics: typeof import('@/infrastructure/observability/metrics/metrics.js').renderMetrics;

  beforeAll(async () => {
    ({ refreshBusinessMetricsGauges } = await import(
      '@/infrastructure/observability/metrics/business-metrics.js'
    ));
    ({ renderMetrics } = await import('@/infrastructure/observability/metrics/metrics.js'));
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    resetMetricsRegistryForTests();
    process.env.METRICS_ENABLED = 'true';
  });

  it('exports mail_outbox_pending and dlq_depth gauges on scrape refresh', async () => {
    await refreshBusinessMetricsGauges();
    const payload = await renderMetrics();

    expect(payload).toMatch(/mail_outbox_pending\{[^}]+\} 3/);
    expect(payload).toMatch(/dlq_depth\{[^}]+\} 7/);
  });
});
