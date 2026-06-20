import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() },
}));

import {
  startProcessMemoryMonitoring,
  stopProcessMemoryMonitoring,
} from '@/shared/utils/infrastructure/process-memory-monitor.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;

function mockRssMegabytes(megabytes: number): void {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: megabytes * BYTES_PER_MEGABYTE,
  } as NodeJS.MemoryUsage);
}

describe('process-memory-monitor', () => {
  afterEach(() => {
    stopProcessMemoryMonitoring();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(logger.warn).mockClear();
  });

  it('warns (tagged with the process label) when RSS exceeds the threshold', () => {
    vi.useFakeTimers();
    mockRssMegabytes(600);
    startProcessMemoryMonitoring({ processLabel: 'api', thresholdMegabytes: 512 });
    vi.advanceTimersByTime(30_000);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ process: 'api', rssMegabytes: 600, thresholdMegabytes: 512 }),
      'process.rss.exceeds.threshold',
    );
  });

  it('does not warn when RSS is below the threshold', () => {
    vi.useFakeTimers();
    mockRssMegabytes(100);
    startProcessMemoryMonitoring({ processLabel: 'worker', thresholdMegabytes: 512 });
    vi.advanceTimersByTime(30_000);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is idempotent — a second start does not register a second interval', () => {
    vi.useFakeTimers();
    mockRssMegabytes(600);
    startProcessMemoryMonitoring({ processLabel: 'api', thresholdMegabytes: 512 });
    startProcessMemoryMonitoring({ processLabel: 'api', thresholdMegabytes: 512 });
    vi.advanceTimersByTime(30_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
