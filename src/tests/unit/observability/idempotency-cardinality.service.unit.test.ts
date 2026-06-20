import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sampleIdempotencyCardinality } from '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.service.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';

const cardinalityTestEnv = vi.hoisted(() => ({
  scanMax: 100,
  warnThreshold: 5,
  criticalThreshold: 20,
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    scan: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureMessage: vi.fn(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    get IDEMPOTENCY_CARDINALITY_SCAN_MAX() {
      return cardinalityTestEnv.scanMax;
    },
    get IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD() {
      return cardinalityTestEnv.warnThreshold;
    },
    get IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD() {
      return cardinalityTestEnv.criticalThreshold;
    },
  },
}));

const mockScan = vi.mocked(redisConnection.scan);
const mockSet = vi.mocked(redisConnection.set);
const mockCaptureMessage = vi.mocked(captureMessage);

describe('sampleIdempotencyCardinality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cardinalityTestEnv.scanMax = 100;
    cardinalityTestEnv.warnThreshold = 5;
    cardinalityTestEnv.criticalThreshold = 20;
    mockSet.mockResolvedValue('OK');
  });

  it('counts keys until scan completes and syncs counter', async () => {
    mockScan.mockResolvedValueOnce(['1', ['k1', 'k2']]).mockResolvedValueOnce(['0', ['k3']]);

    const result = await sampleIdempotencyCardinality();
    expect(result).toEqual({ observedCount: 3, scanTruncated: false });
    expect(mockSet).toHaveBeenCalledWith(expect.stringContaining('idempotency'), '3');
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('marks scanTruncated when capped while SCAN cursor has not returned to zero', async () => {
    cardinalityTestEnv.scanMax = 3;
    mockScan.mockResolvedValueOnce(['99', ['a', 'b', 'c']]);

    const result = await sampleIdempotencyCardinality();
    expect(result).toEqual({ observedCount: 3, scanTruncated: true });
  });

  it('trips the iteration guard and marks truncated when the cursor never settles', async () => {
    cardinalityTestEnv.scanMax = 1000;
    // Cursor never returns to '0' and pages stay empty, so observedCount never reaches the cap;
    // without the round-trip guard this would loop forever and pin Redis CPU.
    mockScan.mockResolvedValue(['99', []]);

    const result = await sampleIdempotencyCardinality();

    expect(result.scanTruncated).toBe(true);
    expect(result.observedCount).toBe(0);
    // ceil(1000 / 1000) + 100 slack = 101 round-trips before the guard trips.
    expect(mockScan).toHaveBeenCalledTimes(101);
  });

  it('logs a warning and captures a Sentry message at warn threshold', async () => {
    mockScan.mockResolvedValueOnce(['0', ['a', 'b', 'c', 'd', 'e']]);
    const result = await sampleIdempotencyCardinality();
    expect(result.observedCount).toBe(5);
    expect(mockCaptureMessage).toHaveBeenCalledWith('idempotency.cache.cardinality.high', {
      level: 'warning',
      extra: expect.objectContaining({
        observedCount: 5,
        warnThreshold: 5,
        criticalThreshold: 20,
        scanTruncated: false,
      }),
    });
  });

  it('captures a Sentry error at critical threshold', async () => {
    cardinalityTestEnv.warnThreshold = 2;
    cardinalityTestEnv.criticalThreshold = 4;
    mockScan.mockResolvedValueOnce(['0', ['a', 'b', 'c', 'd', 'e']]);

    await sampleIdempotencyCardinality();

    expect(mockCaptureMessage).toHaveBeenCalledWith('idempotency.cache.cardinality.critical', {
      level: 'error',
      extra: expect.objectContaining({ observedCount: 5 }),
    });
    expect(mockCaptureMessage).not.toHaveBeenCalledWith(
      'idempotency.cache.cardinality.high',
      expect.anything(),
    );
  });
});
