import { THIRTY_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;

let memoryMonitorInterval: ReturnType<typeof setInterval> | null = null;

/** Which process the monitor is running in — tags the warning log so API vs worker growth is distinguishable. */
export type MonitoredProcessLabel = 'api' | 'worker';

/**
 * Starts periodic RSS (resident memory) monitoring for the current process: every 30s it logs a
 * `process.rss.exceeds.threshold` warning when resident memory exceeds `thresholdMegabytes`.
 *
 * @remarks
 * - **Algorithm:** a single unref'd `setInterval` samples `process.memoryUsage().rss` and warns past
 *   the threshold. Idempotent — a second call while a monitor is already running is a no-op.
 * - **Failure modes:** none — sampling cannot throw and nothing is awaited.
 * - **Side effects:** registers one interval timer (unref'd, so it never keeps the event loop alive);
 *   exact RSS/heap series are also exported to Prometheus via prom-client default metrics
 *   (`process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`) — this adds the alert signal on top.
 */
export function startProcessMemoryMonitoring(options: {
  processLabel: MonitoredProcessLabel;
  thresholdMegabytes: number;
}): void {
  if (memoryMonitorInterval) {
    return;
  }
  const thresholdBytes = options.thresholdMegabytes * BYTES_PER_MEGABYTE;
  memoryMonitorInterval = setInterval(() => {
    const rssBytes = process.memoryUsage().rss;
    if (rssBytes > thresholdBytes) {
      logger.warn(
        {
          process: options.processLabel,
          rssMegabytes: Math.round(rssBytes / BYTES_PER_MEGABYTE),
          thresholdMegabytes: options.thresholdMegabytes,
        },
        'process.rss.exceeds.threshold',
      );
    }
  }, THIRTY_SECONDS_MS);
  memoryMonitorInterval.unref();
}

/** Stops the monitor started by {@link startProcessMemoryMonitoring}. Idempotent. */
export function stopProcessMemoryMonitoring(): void {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
  }
}
