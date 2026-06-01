import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInfo = vi.fn();
const mockGetJobCounts = vi.fn();
const mockQueueClose = vi.fn();
const mockCaptureMessage = vi.fn();

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: { info: (...args: unknown[]) => mockInfo(...args) },
}));

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    getJobCounts = mockGetJobCounts;
    close = mockQueueClose;
  },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function buildMemoryInfo(usedMemory: number, maxMemory: number): string {
  return ['# Memory', `used_memory:${usedMemory}`, `maxmemory:${maxMemory}`, ''].join('\r\n');
}

describe('redis-saturation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobCounts.mockResolvedValue({ waiting: 0, delayed: 0 });
    mockQueueClose.mockResolvedValue(undefined);
  });

  it('parseRedisMemoryInfo extracts used_memory and maxmemory, defaulting missing fields to 0', async () => {
    const { parseRedisMemoryInfo } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );
    expect(parseRedisMemoryInfo(buildMemoryInfo(960, 1000))).toEqual({
      usedMemory: 960,
      maxMemory: 1000,
    });
    expect(parseRedisMemoryInfo('# Memory\r\nused_memory:512\r\n')).toEqual({
      usedMemory: 512,
      maxMemory: 0,
    });
    expect(parseRedisMemoryInfo('garbage')).toEqual({ usedMemory: 0, maxMemory: 0 });
  });

  it('raises a critical Sentry alert when the memory ratio crosses the critical threshold', async () => {
    mockInfo.mockResolvedValue(buildMemoryInfo(960, 1000));
    const { sampleRedisMemorySaturation } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );

    const result = await sampleRedisMemorySaturation();

    expect(result.ratio).toBeCloseTo(0.96);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'redis.memory.saturation.critical',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('raises a warning Sentry alert between warn and critical thresholds', async () => {
    mockInfo.mockResolvedValue(buildMemoryInfo(900, 1000));
    const { sampleRedisMemorySaturation } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );

    const result = await sampleRedisMemorySaturation();

    expect(result.ratio).toBeCloseTo(0.9);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'redis.memory.saturation.high',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('does not alert for an unbounded Redis (maxmemory=0) and returns a null ratio', async () => {
    mockInfo.mockResolvedValue(buildMemoryInfo(5_000, 0));
    const { sampleRedisMemorySaturation } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );

    const result = await sampleRedisMemorySaturation();

    expect(result.ratio).toBeNull();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('never throws when the INFO probe fails — returns a null ratio', async () => {
    mockInfo.mockRejectedValue(new Error('redis down'));
    const { sampleRedisMemorySaturation } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );

    const result = await sampleRedisMemorySaturation();

    expect(result.ratio).toBeNull();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('alerts when a source queue waiting+delayed backlog exceeds the threshold', async () => {
    mockGetJobCounts.mockResolvedValue({ waiting: 1500, delayed: 0 });
    const { sampleBullMqSourceQueueWaitingDepth } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );

    const result = await sampleBullMqSourceQueueWaitingDepth();

    expect(result.depths.length).toBeGreaterThan(0);
    expect(result.depths[0]?.total).toBe(1500);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'queue.waiting.depth.high',
      expect.objectContaining({ level: 'warning' }),
    );
    expect(mockQueueClose).toHaveBeenCalled();
  });

  it('records depth 0 and does not abort when a single queue probe fails', async () => {
    mockGetJobCounts.mockRejectedValue(new Error('queue unreachable'));
    const { sampleBullMqSourceQueueWaitingDepth } = await import(
      '@/infrastructure/observability/redis-saturation/redis-saturation.service.js'
    );

    const result = await sampleBullMqSourceQueueWaitingDepth();

    expect(result.depths.every((entry) => entry.total === 0)).toBe(true);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockQueueClose).toHaveBeenCalled();
  });
});
