import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { setEventLoopLagMilliseconds } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

/** Sampling resolution for monitorEventLoopDelay (ms). */
export const EVENT_LOOP_MONITORING_RESOLUTION_MS = 10;

let eventLoopDelayHistogram: IntervalHistogram | null = null;

function getEventLoopDelayHistogram(): IntervalHistogram | null {
  if (eventLoopDelayHistogram) {
    return eventLoopDelayHistogram;
  }
  try {
    const histogram = monitorEventLoopDelay({
      resolution: EVENT_LOOP_MONITORING_RESOLUTION_MS,
    });
    histogram.enable();
    eventLoopDelayHistogram = histogram;
    return histogram;
  } catch {
    return null;
  }
}

/** Registers perf_hooks event-loop monitoring when metrics are enabled. */
export function registerEventLoopMetrics(): void {
  if (!isMetricsEnabled()) {
    return;
  }
  getEventLoopDelayHistogram();
}

/**
 * Samples p99 event-loop delay (ms) for Prometheus scrape.
 * No-op when perf_hooks monitoring is unavailable.
 */
export function refreshEventLoopMetrics(): void {
  if (!isMetricsEnabled()) {
    return;
  }

  const histogram = getEventLoopDelayHistogram();
  if (!histogram) {
    return;
  }

  const lagNanoseconds = histogram.percentile(99);
  const lagMilliseconds = lagNanoseconds / 1_000_000;
  setEventLoopLagMilliseconds(lagMilliseconds);
}

/** Test-only: reset histogram singleton between Vitest cases. */
export function resetEventLoopMetricsForTests(): void {
  eventLoopDelayHistogram = null;
}
