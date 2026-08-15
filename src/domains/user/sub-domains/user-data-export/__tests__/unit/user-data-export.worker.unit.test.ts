import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker-level suite for the `user-data-export` queue consumer.
 *
 * The processor unit test (`user-data-export.processor.unit.test.ts`) already proves what the
 * export *does*; this file proves the wiring around it — queue name, concurrency source, payload
 * validation before the job runs, trace-context propagation, stalled logging, and that failures
 * propagate to BullMQ rather than being swallowed into a false success.
 */
const workerState = vi.hoisted(() => ({
  queueName: undefined as string | undefined,
  processor: undefined as ((job: unknown) => Promise<unknown>) | undefined,
  options: undefined as Record<string, unknown> | undefined,
  onHandlers: {} as Record<string, (...args: unknown[]) => void>,
}));

const parseJobDataOrDeadLetterMock = vi.fn();
const runUserDataExportJobMock = vi.fn();
const runWithPropagatedTraceContextMock = vi.fn();

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
  getDefaultWorkerOptions: () => ({ lockDuration: 60_000, stalledInterval: 30_000 }),
}));

vi.mock('@/shared/config/worker-concurrency.util.js', () => ({
  getWorkerConcurrencyNotify: () => 7,
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (worker: unknown, queueName: string) => ({
    worker,
    queueName,
    close: async () => undefined,
  }),
}));

vi.mock('@/infrastructure/queue/dlq/poison-job.util.js', () => ({
  parseJobDataOrDeadLetter: (...args: unknown[]) => parseJobDataOrDeadLetterMock(...args),
}));

vi.mock('@/infrastructure/observability/tracing/trace-context.util.js', () => ({
  runWithPropagatedTraceContext: (...args: unknown[]) => runWithPropagatedTraceContextMock(...args),
}));

vi.mock(
  '@/domains/user/sub-domains/user-data-export/workers/user-data-export.processor.js',
  () => ({
    runUserDataExportJob: (...args: unknown[]) => runUserDataExportJobMock(...args),
  }),
);

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const JOB_DATA = {
  exportPublicId: 'ude_aaaaaaaaaaaaaaaaaaaaa',
  userPublicId: 'usr_bbbbbbbbbbbbbbbbbbbbb',
  userInternalId: 42,
  traceparent: '00-trace-span-01',
  tracestate: 'vendor=1',
};

const service = { name: 'user-data-export-service' } as never;

async function importWorkerFactory() {
  const module = await import(
    '@/domains/user/sub-domains/user-data-export/workers/user-data-export.worker.js'
  );
  return module.createUserDataExportWorker;
}

describe('user-data-export.worker', () => {
  beforeEach(() => {
    workerState.queueName = undefined;
    workerState.processor = undefined;
    workerState.options = undefined;
    workerState.onHandlers = {};
    parseJobDataOrDeadLetterMock.mockReset();
    runUserDataExportJobMock.mockReset();
    runWithPropagatedTraceContextMock.mockReset();

    parseJobDataOrDeadLetterMock.mockResolvedValue(JOB_DATA);
    runUserDataExportJobMock.mockResolvedValue(undefined);
    // Faithful stand-in: run the callback so the assertions below observe the real
    // call order (parse → trace context → job) instead of a short-circuited stub.
    runWithPropagatedTraceContextMock.mockImplementation(
      async (_carrier: unknown, _name: string, callback: () => Promise<unknown>) => callback(),
    );
  });

  it('creates the BullMQ Worker on the user-data-export queue', async () => {
    const createUserDataExportWorker = await importWorkerFactory();

    const handle = createUserDataExportWorker(service);

    expect(workerState.queueName).toBe('user-data-export');
    expect(handle.queueName).toBe('user-data-export');
    expect(handle.worker).toBeDefined();
  });

  it('takes concurrency from getWorkerConcurrencyNotify and merges the default worker options', async () => {
    const createUserDataExportWorker = await importWorkerFactory();

    createUserDataExportWorker(service);

    expect(workerState.options).toEqual(
      expect.objectContaining({ concurrency: 7, lockDuration: 60_000, stalledInterval: 30_000 }),
    );
  });

  it('validates the payload before running the job and propagates trace context', async () => {
    const createUserDataExportWorker = await importWorkerFactory();

    createUserDataExportWorker(service);
    const job = { name: 'process-user-data-export', data: JOB_DATA };
    await workerState.processor?.(job);

    expect(parseJobDataOrDeadLetterMock).toHaveBeenCalledWith(
      expect.objectContaining({ job, queueName: 'user-data-export' }),
    );
    expect(runWithPropagatedTraceContextMock).toHaveBeenCalledWith(
      { traceparent: JOB_DATA.traceparent, tracestate: JOB_DATA.tracestate },
      'process-user-data-export',
      expect.any(Function),
    );
    expect(runUserDataExportJobMock).toHaveBeenCalledWith(JOB_DATA, service);
  });

  it('does not run the job when the payload fails validation (poison job is dead-lettered)', async () => {
    parseJobDataOrDeadLetterMock.mockRejectedValue(new Error('unparseable-job-payload'));

    const createUserDataExportWorker = await importWorkerFactory();
    createUserDataExportWorker(service);

    await expect(
      workerState.processor?.({ name: 'process-user-data-export', data: { bogus: true } }),
    ).rejects.toThrow('unparseable-job-payload');
    expect(runUserDataExportJobMock).not.toHaveBeenCalled();
  });

  it('logs a warning with queue name and jobId when a job stalls', async () => {
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const createUserDataExportWorker = await importWorkerFactory();

    createUserDataExportWorker(service);
    workerState.onHandlers.stalled?.('job-export-001');

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { jobId: 'job-export-001', queue: 'user-data-export' },
      'user-data-export.worker.stalled',
    );
  });

  it('propagates a processor failure so BullMQ can retry or dead-letter it', async () => {
    runUserDataExportJobMock.mockRejectedValue(new Error('export-bundling-failed'));

    const createUserDataExportWorker = await importWorkerFactory();
    createUserDataExportWorker(service);

    await expect(
      workerState.processor?.({ name: 'process-user-data-export', data: JOB_DATA }),
    ).rejects.toThrow('export-bundling-failed');
  });
});
