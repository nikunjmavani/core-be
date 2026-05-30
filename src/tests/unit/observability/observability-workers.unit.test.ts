import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerState = vi.hoisted(() => ({
  processors: new Map<string, () => Promise<unknown>>(),
  options: new Map<string, Record<string, unknown>>(),
}));

const sampleIdempotencyCardinalityMock = vi.fn();
const sampleDeadLetterQueueDepthsMock = vi.fn();
const sampleBullMqSourceQueueWaitingDepthMock = vi.fn();
const sampleRedisMemorySaturationMock = vi.fn();

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function WorkerMock(queueName, processor, options) {
    workerState.processors.set(queueName, processor);
    workerState.options.set(queueName, options);
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }),
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({ host: 'redis.test' }),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (worker: unknown, queueName: string) => ({
    worker,
    queueName,
    close: async () => undefined,
  }),
}));

vi.mock(
  '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.service.js',
  () => ({
    sampleIdempotencyCardinality: (...parameters: unknown[]) =>
      sampleIdempotencyCardinalityMock(...parameters),
  }),
);

vi.mock('@/infrastructure/observability/dlq-depth/dlq-depth.service.js', () => ({
  sampleDeadLetterQueueDepths: (...parameters: unknown[]) =>
    sampleDeadLetterQueueDepthsMock(...parameters),
}));

vi.mock('@/infrastructure/observability/redis-saturation/redis-saturation.service.js', () => ({
  sampleBullMqSourceQueueWaitingDepth: (...parameters: unknown[]) =>
    sampleBullMqSourceQueueWaitingDepthMock(...parameters),
  sampleRedisMemorySaturation: (...parameters: unknown[]) =>
    sampleRedisMemorySaturationMock(...parameters),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('observability workers', () => {
  beforeEach(() => {
    workerState.processors.clear();
    workerState.options.clear();
    sampleIdempotencyCardinalityMock.mockReset();
    sampleDeadLetterQueueDepthsMock.mockReset();
    sampleBullMqSourceQueueWaitingDepthMock.mockReset();
    sampleRedisMemorySaturationMock.mockReset();
    sampleBullMqSourceQueueWaitingDepthMock.mockResolvedValue({ depths: [] });
    sampleRedisMemorySaturationMock.mockResolvedValue({
      usedMemory: 0,
      maxMemory: 0,
      ratio: null,
    });
  });

  it('idempotency-cardinality worker samples Redis cardinality on its queue', async () => {
    sampleIdempotencyCardinalityMock.mockResolvedValue({
      observedCount: 7,
      scanTruncated: false,
    });

    const { createIdempotencyCardinalityWorker } = await import(
      '@/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.worker.js'
    );

    const handle = createIdempotencyCardinalityWorker();
    const result = await workerState.processors.get('idempotency-cardinality')?.();

    expect(handle.queueName).toBe('idempotency-cardinality');
    expect(workerState.options.get('idempotency-cardinality')).toEqual(
      expect.objectContaining({ concurrency: 1 }),
    );
    expect(sampleIdempotencyCardinalityMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ observedCount: 7, scanTruncated: false });
  });

  it('dlq-depth worker samples dead-letter queue depths on its queue', async () => {
    sampleDeadLetterQueueDepthsMock.mockResolvedValue({
      depths: [{ queueName: 'mail-dlq', failedCount: 2 }],
    });

    const { createDlqDepthWorker } = await import(
      '@/infrastructure/observability/dlq-depth/dlq-depth.worker.js'
    );

    const handle = createDlqDepthWorker();
    const result = await workerState.processors.get('dlq-depth')?.();

    expect(handle.queueName).toBe('dlq-depth');
    expect(workerState.options.get('dlq-depth')).toEqual(
      expect.objectContaining({ concurrency: 1 }),
    );
    expect(sampleDeadLetterQueueDepthsMock).toHaveBeenCalledOnce();
    expect(sampleBullMqSourceQueueWaitingDepthMock).toHaveBeenCalledOnce();
    expect(sampleRedisMemorySaturationMock).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });
});
