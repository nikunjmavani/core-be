import { THIRTY_SECONDS_MS } from '@/shared/constants/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** Options for {@link startRssMonitor}. */
export interface RssMonitorOptions {
  /** Process label used in the warn log key (`<label>.rss.exceeds.threshold`). */
  processLabel: 'api' | 'worker';
  /** Resident-set-size ceiling in MB above which a warn is logged each interval. */
  thresholdMegabytes: number;
  /** Sampling interval in ms (default 30s). */
  intervalMs?: number;
}

/**
 * Starts a periodic resident-set-size (RSS) sampler that logs a warn each interval the
 * process exceeds `thresholdMegabytes`, and returns a stop function.
 *
 * @remarks
 * - **Algorithm:** every `intervalMs` reads `process.memoryUsage().rss` and warns when it
 *   crosses the threshold (a steady stream of warns signals a leak / runaway growth that
 *   external alerting can page on).
 * - **Side effects:** the timer is `unref()`-ed so it never keeps the event loop alive during
 *   shutdown; callers that want deterministic teardown can still invoke the returned stopper.
 * - **Notes:** shared by the API (`server.ts`) and worker (`bootstrap.ts`) so both processes
 *   get identical memory observability.
 */
export function startRssMonitor(options: RssMonitorOptions): () => void {
  const thresholdBytes = options.thresholdMegabytes * BYTES_PER_MEGABYTE;
  const interval = setInterval(() => {
    const rssBytes = process.memoryUsage().rss;
    if (rssBytes > thresholdBytes) {
      logger.warn(
        {
          process: options.processLabel,
          rssMegabytes: Math.round(rssBytes / BYTES_PER_MEGABYTE),
          thresholdMegabytes: options.thresholdMegabytes,
        },
        `${options.processLabel}.rss.exceeds.threshold`,
      );
    }
  }, options.intervalMs ?? THIRTY_SECONDS_MS);
  interval.unref();
  return () => clearInterval(interval);
}
