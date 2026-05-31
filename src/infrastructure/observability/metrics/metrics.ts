import {
  getMetricsRegistry,
  isMetricsEnabled,
} from '@/infrastructure/observability/metrics/metrics-registry.js';

export {
  getMetricsRegistry,
  isMetricsEnabled,
  resetMetricsRegistryForTests,
} from '@/infrastructure/observability/metrics/metrics-registry.js';

type MetricsStackModules = {
  bullmq: typeof import('@/infrastructure/observability/metrics/bullmq-metrics.js');
  business: typeof import('@/infrastructure/observability/metrics/business-metrics.js');
  eventLoop: typeof import('@/infrastructure/observability/metrics/event-loop-metrics.js');
  postgresPool: typeof import('@/infrastructure/observability/metrics/db-pool-metrics.js');
  prometheus: typeof import('@/infrastructure/observability/metrics/prometheus-metrics.js');
};

let metricsStackModulesPromise: Promise<MetricsStackModules> | null = null;

function loadMetricsStackModules(): Promise<MetricsStackModules> {
  metricsStackModulesPromise ??= Promise.all([
    import('@/infrastructure/observability/metrics/bullmq-metrics.js'),
    import('@/infrastructure/observability/metrics/business-metrics.js'),
    import('@/infrastructure/observability/metrics/event-loop-metrics.js'),
    import('@/infrastructure/observability/metrics/db-pool-metrics.js'),
    import('@/infrastructure/observability/metrics/prometheus-metrics.js'),
  ]).then(([bullmq, business, eventLoop, postgresPool, prometheus]) => ({
    bullmq,
    business,
    eventLoop,
    postgresPool,
    prometheus,
  }));
  return metricsStackModulesPromise;
}

async function ensureMetricsStackInitialized(): Promise<MetricsStackModules | null> {
  if (!isMetricsEnabled()) {
    return null;
  }
  const modules = await loadMetricsStackModules();
  const registry = getMetricsRegistry();
  modules.prometheus.ensurePrometheusMetricsRegistered(registry);
  modules.postgresPool.registerPostgresPoolMetrics();
  modules.eventLoop.registerEventLoopMetrics();
  return modules;
}

/** Refreshes dynamic gauges (BullMQ depths) immediately before a Prometheus scrape. */
export async function refreshMetricsBeforeScrape(): Promise<void> {
  const modules = await ensureMetricsStackInitialized();
  if (!modules) {
    return;
  }
  modules.eventLoop.refreshEventLoopMetrics();
  await Promise.all([
    modules.postgresPool.refreshPostgresPoolMetrics(),
    modules.bullmq.refreshBullMQQueueGauges(),
    modules.business.refreshBusinessMetricsGauges(),
  ]);
}

/** Renders the current Prometheus exposition payload after the scrape refresh path has run. */
export async function renderMetrics(): Promise<string> {
  if (!isMetricsEnabled()) {
    return '';
  }
  return getMetricsRegistry().metrics();
}
