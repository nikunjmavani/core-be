import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

let sharedHistogram: IntervalHistogram | null = null;

/**
 * Returns a shared, process-wide `monitorEventLoopDelay` histogram.
 *
 * @remarks
 * Merging the two previously-separate histograms (overload-guard + metrics) into one
 * singleton cuts C++→JS event-loop callbacks from 200/sec to 100/sec, reducing
 * micro-jitter that contributes to P99 variance. Both consumers read the same
 * histogram; the overload guard resets it every 500 ms, while the metrics scraper
 * reads the current p99 without resetting.
 */
export function getSharedEventLoopHistogram(): IntervalHistogram {
  if (!sharedHistogram) {
    sharedHistogram = monitorEventLoopDelay({ resolution: 10 });
    sharedHistogram.enable();
  }
  return sharedHistogram;
}

/** Test-only: reset the singleton so Vitest cases start from a clean state. */
export function resetSharedEventLoopHistogram(): void {
  sharedHistogram?.disable();
  sharedHistogram = null;
}
