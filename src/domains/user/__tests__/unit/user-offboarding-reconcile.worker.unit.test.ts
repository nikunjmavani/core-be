import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker-level suite for the `user-offboarding-reconcile` scheduled re-drive (USER-04 / USER-09).
 *
 * Unlike the two retention workers, this one takes no database-context wrapper — it hands the
 * injected service straight to the processor, which opens per-user contexts itself. The wiring
 * proven here is therefore the service hand-off, the retention concurrency, and that a scan
 * failure surfaces to BullMQ rather than being reported as a completed reconcile.
 */
const workerState = vi.hoisted(() => ({
  queueName: undefined as string | undefined,
  processor: undefined as (() => Promise<unknown>) | undefined,
  options: undefined as Record<string, unknown> | undefined,
  onHandlers: {} as Record<string, (...args: unknown[]) => void>,
}));

const runUserOffboardingReconcileJobMock = vi.fn();

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function WorkerMock(queueName, processor, options) {
    workerState.queueName = queueName;
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

vi.mock('@/domains/user/workers/user-offboarding-reconcile.processor.js', () => ({
  runUserOffboardingReconcileJob: (...args: unknown[]) =>
    runUserOffboardingReconcileJobMock(...args),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const service = { resumeOffboarding: vi.fn() } as never;

async function importWorkerFactory() {
  const module = await import('@/domains/user/workers/user-offboarding-reconcile.worker.js');
  return module.createUserOffboardingReconcileWorker;
}

describe('user-offboarding-reconcile.worker', () => {
  beforeEach(() => {
    workerState.queueName = undefined;
    workerState.processor = undefined;
    workerState.options = undefined;
    workerState.onHandlers = {};
    runUserOffboardingReconcileJobMock.mockReset();
    runUserOffboardingReconcileJobMock.mockResolvedValue({ scanned: 5, resumed: 2, failed: 0 });
  });

  it('creates the BullMQ Worker on the user-offboarding-reconcile queue', async () => {
    const createUserOffboardingReconcileWorker = await importWorkerFactory();

    const handle = createUserOffboardingReconcileWorker(service);

    expect(workerState.queueName).toBe('user-offboarding-reconcile');
    expect(handle.queueName).toBe('user-offboarding-reconcile');
    expect(handle.worker).toBeDefined();
  });

  it('runs at RETENTION_WORKER_CONCURRENCY with the retention worker options', async () => {
    const createUserOffboardingReconcileWorker = await importWorkerFactory();

    createUserOffboardingReconcileWorker(service);

    expect(workerState.options).toEqual(
      expect.objectContaining({ concurrency: 1, lockDuration: 120_000, maxStalledCount: 1 }),
    );
  });

  it('hands the injected service to the processor and returns its counters', async () => {
    const createUserOffboardingReconcileWorker = await importWorkerFactory();

    createUserOffboardingReconcileWorker(service);
    const result = await workerState.processor?.();

    expect(runUserOffboardingReconcileJobMock).toHaveBeenCalledWith(service);
    expect(result).toEqual({ scanned: 5, resumed: 2, failed: 0 });
  });

  it('logs a warning with queue name and jobId when a job stalls', async () => {
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const createUserOffboardingReconcileWorker = await importWorkerFactory();

    createUserOffboardingReconcileWorker(service);
    workerState.onHandlers.stalled?.('job-offboarding-001');

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { jobId: 'job-offboarding-001', queue: 'user-offboarding-reconcile' },
      'user-offboarding-reconcile.stalled',
    );
  });

  it('propagates a scan failure so the tick is retried rather than recorded as reconciled', async () => {
    runUserOffboardingReconcileJobMock.mockRejectedValue(new Error('offboarding-scan-failed'));

    const createUserOffboardingReconcileWorker = await importWorkerFactory();
    createUserOffboardingReconcileWorker(service);

    await expect(workerState.processor?.()).rejects.toThrow('offboarding-scan-failed');
  });
});
