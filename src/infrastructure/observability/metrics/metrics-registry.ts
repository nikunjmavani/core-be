import { collectDefaultMetrics, Registry } from 'prom-client';
import { getEnv } from '@/shared/config/env.config.js';

let metricsRegistry: Registry | null = null;

export function isMetricsEnabled(): boolean {
  return getEnv().METRICS_ENABLED === true;
}

/** Prometheus registry singleton (default + custom metrics register here). */
export function getMetricsRegistry(): Registry {
  if (!metricsRegistry) {
    metricsRegistry = new Registry();
    const environment = getEnv();
    metricsRegistry.setDefaultLabels({
      service: 'core-be',
      environment: environment.SENTRY_ENVIRONMENT ?? environment.NODE_ENV,
    });
    collectDefaultMetrics({ register: metricsRegistry });
  }
  return metricsRegistry;
}

/** Test-only: clear registry between Vitest cases that toggle METRICS_ENABLED. */
export function resetMetricsRegistryForTests(): void {
  metricsRegistry = null;
}
