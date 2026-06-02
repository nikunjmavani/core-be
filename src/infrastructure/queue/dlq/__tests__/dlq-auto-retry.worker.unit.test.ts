import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerState = vi.hoisted(() => ({
  processor: undefined as (() => Promise<unknown>) | undefined,
  options: undefined as Record<string, unknown> | undefined,
  onHandlers: {} as Record<string, (...args: unknown[]) => void>,
}));

const runDlqAutoRetryJobMock = vi.fn();

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function WorkerMock(_queueName, processor, options) {
    workerState.processor = processor;
    workerState.options = options;
    return {
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        workerState.onHandlers[event] = handler;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({ host: 'redis.test' }),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-options.js', () => ({
  getRetentionWorkerOptions: () => ({
    lockDuration: 120_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  }),
  RETENTION_WORKER_CONCURRENCY: 1,
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (worker: unknown, queueName: string) => ({
    worker,
    queueName,
    close: async () => undefined,
  }),
}));

vi.mock('@/infrastructure/queue/dlq/dlq-auto-retry.processor.js', () => ({
  runDlqAutoRetryJob: () => runDlqAutoRetryJobMock(),
}));

vi.mock('@/infrastructure/queue/dlq/dlq-auto-retry.constants.js', () => ({
  DLQ_AUTO_RETRY_QUEUE_NAME: 'dlq-auto-retry',
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('dlq-auto-retry.worker', () => {
  beforeEach(() => {
    workerState.processor = undefined;
    workerState.options = undefined;
    workerState.onHandlers = {};
    runDlqAutoRetryJobMock.mockReset();

    runDlqAutoRetryJobMock.mockResolvedValue({
      scannedCount: 5,
      replayedCount: 3,
      skippedCircuitOpenCount: 1,
      skippedCooldownCount: 1,
      skippedBudgetCount: 0,
      skippedPayloadCount: 0,
    });
  });

  it('creates BullMQ Worker with the correct dlq-auto-retry queue name', async () => {
    const { createDlqAutoRetryWorker } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry.worker.js'
    );

    const handle = createDlqAutoRetryWorker();

    expect(handle.queueName).toBe('dlq-auto-retry');
  });

  it('creates worker with RETENTION_WORKER_CONCURRENCY of 1', async () => {
    const { createDlqAutoRetryWorker } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry.worker.js'
    );

    createDlqAutoRetryWorker();

    expect(workerState.options).toEqual(expect.objectContaining({ concurrency: 1 }));
  });

  it('processor delegates to runDlqAutoRetryJob and returns result', async () => {
    const { createDlqAutoRetryWorker } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry.worker.js'
    );

    createDlqAutoRetryWorker();
    const result = await workerState.processor?.();

    expect(runDlqAutoRetryJobMock).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({
        scannedCount: 5,
        replayedCount: 3,
      }),
    );
  });

  it('stalled handler logs a warning with queue name and jobId', async () => {
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const { createDlqAutoRetryWorker } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry.worker.js'
    );

    createDlqAutoRetryWorker();
    workerState.onHandlers.stalled?.('job-dlq-001');

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { jobId: 'job-dlq-001', queue: 'dlq-auto-retry' },
      'dlq-auto-retry.stalled',
    );
  });

  it('buildWorkerHandle is called with worker and queue name', async () => {
    const { createDlqAutoRetryWorker } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry.worker.js'
    );

    const handle = createDlqAutoRetryWorker();

    expect(handle.worker).toBeDefined();
    expect(handle.queueName).toBe('dlq-auto-retry');
  });

  it('processor throws when runDlqAutoRetryJob throws — error propagates out', async () => {
    runDlqAutoRetryJobMock.mockRejectedValue(new Error('dlq-job-failure'));

    const { createDlqAutoRetryWorker } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry.worker.js'
    );

    createDlqAutoRetryWorker();

    await expect(workerState.processor?.()).rejects.toThrow('dlq-job-failure');
  });
});
