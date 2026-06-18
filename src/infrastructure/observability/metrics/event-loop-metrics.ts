import {
  getSharedEventLoopHistogram,
  resetSharedEventLoopHistogram,
} from '@/shared/utils/infrastructure/event-loop-monitor.js';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { setEventLoopLagMilliseconds } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

/** Registers perf_hooks event-loop monitoring when metrics are enabled. */
export function registerEventLoopMetrics(): void {
  if (!isMetricsEnabled()) {
    return;
  }
  getSharedEventLoopHistogram();
}

/**
 * Samples p99 event-loop delay (ms) for Prometheus scrape.
 * No-op when perf_hooks monitoring is unavailable.
 */
export function refreshEventLoopMetrics(): void {
  if (!isMetricsEnabled()) {
    return;
  }

  const histogram = getSharedEventLoopHistogram();
  const lagNanoseconds = histogram.percentile(99);
  const lagMilliseconds = lagNanoseconds / 1_000_000;
  setEventLoopLagMilliseconds(lagMilliseconds);
}

/** Test-only: reset histogram singleton between Vitest cases. */
export function resetEventLoopMetricsForTests(): void {
  resetSharedEventLoopHistogram();
}
