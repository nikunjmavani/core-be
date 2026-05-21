import { refreshBullMQQueueGauges } from '@/infrastructure/observability/metrics/bullmq-metrics.js';
import {
  registerPostgresPoolMetrics,
  refreshPostgresPoolMetrics,
} from '@/infrastructure/observability/metrics/db-pool-metrics.js';
import {
  registerEventLoopMetrics,
  refreshEventLoopMetrics,
} from '@/infrastructure/observability/metrics/event-loop-metrics.js';
import {
  getMetricsRegistry,
  isMetricsEnabled,
} from '@/infrastructure/observability/metrics/metrics-registry.js';
import { ensurePrometheusMetricsRegistered } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

export {
  getMetricsRegistry,
  isMetricsEnabled,
  resetMetricsRegistryForTests,
} from '@/infrastructure/observability/metrics/metrics-registry.js';

function ensureMetricsStackInitialized(): void {
  if (!isMetricsEnabled()) {
    return;
  }
  const registry = getMetricsRegistry();
  ensurePrometheusMetricsRegistered(registry);
  registerPostgresPoolMetrics();
  registerEventLoopMetrics();
}

/** Refreshes dynamic gauges (BullMQ depths) immediately before a Prometheus scrape. */
export async function refreshMetricsBeforeScrape(): Promise<void> {
  if (!isMetricsEnabled()) {
    return;
  }
  ensureMetricsStackInitialized();
  refreshEventLoopMetrics();
  await Promise.all([refreshPostgresPoolMetrics(), refreshBullMQQueueGauges()]);
}

export async function renderMetrics(): Promise<string> {
  ensureMetricsStackInitialized();
  return getMetricsRegistry().metrics();
}
