import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Worker } from 'bullmq';

interface QueueAddCall {
  jobName: string;
  data: Record<string, unknown>;
  options: Record<string, unknown>;
}

const queueConstructorMock = vi.fn();
const queueAddCalls: QueueAddCall[] = [];
const queueAddMock = vi.fn<(jobName: string, data: unknown, options: unknown) => Promise<void>>();
const queueCloseMock = vi.fn().mockResolvedValue(undefined);
const sentryCaptureExceptionMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    constructor(name: string, options: unknown) {
      queueConstructorMock(name, options);
    }

    add = queueAddMock;

    close = queueCloseMock;
  },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  isSentryInitialized: () => true,
  Sentry: {
    withScope: (callback: (scope: unknown) => void) => {
      callback({
        setLevel: vi.fn(),
        setFingerprint: vi.fn(),
        setTag: vi.fn(),
      });
    },
    captureException: (...arguments_: unknown[]) => sentryCaptureExceptionMock(...arguments_),
  },
}));

function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    name: 'dispatch-notification',
    data: { webhookId: 'webhook-99', eventType: 'invoice.paid' },
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...overrides,
  } as Job;
}

describe('enqueueDeadLetter metadata', () => {
  beforeEach(async () => {
    queueAddCalls.length = 0;
    queueAddMock.mockReset();
    queueAddMock.mockImplementation(async (jobName, data, options) => {
      queueAddCalls.push({
        jobName,
        data: data as Record<string, unknown>,
        options: options as Record<string, unknown>,
      });
    });
    queueConstructorMock.mockClear();
    queueCloseMock.mockClear();
    sentryCaptureExceptionMock.mockClear();
    /** Reset module state so the queue cache is fresh for every test. */
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDeadLetterQueues } = await import('@/infrastructure/queue/dlq/dead-letter.js');
    await closeDeadLetterQueues();
  });

  it('enqueueDeadLetter routes to <sourceQueue>-dlq queue name', async () => {
    const { enqueueDeadLetter } = await import('@/infrastructure/queue/dlq/dead-letter.js');

    await enqueueDeadLetter('webhook-delivery', buildJob({ id: 'job-route' }), new Error('boom'));

    expect(queueConstructorMock).toHaveBeenCalledTimes(1);
    expect(queueConstructorMock.mock.calls[0]?.[0]).toBe('webhook-delivery-dlq');
  });

  it('enqueueDeadLetter includes attempts_made and error metadata in DLQ payload', async () => {
    const { enqueueDeadLetter } = await import('@/infrastructure/queue/dlq/dead-letter.js');

    const error = new Error('permanent-failure');
    error.stack = 'Error: permanent-failure\n    at test';
    const job = buildJob({
      id: 'job-metadata',
      attemptsMade: 4,
      opts: { attempts: 4 },
    });

    await enqueueDeadLetter('notification', job, error);

    expect(queueAddCalls).toHaveLength(1);
    const [{ jobName, data, options }] = queueAddCalls as [QueueAddCall];
    expect(jobName).toBe('dead-letter');
    expect(data).toMatchObject({
      original_queue: 'notification',
      original_job_id: 'job-metadata',
      original_job_name: 'dispatch-notification',
      failed_reason: 'permanent-failure',
      error_stack: 'Error: permanent-failure\n    at test',
      attempts_made: 4,
      max_attempts: 4,
    });
    expect(typeof data.failed_at).toBe('string');
    expect(Date.parse(String(data.failed_at))).not.toBeNaN();
    expect(options).toMatchObject({
      jobId: 'dlq-notification-job-metadata',
    });
  });

  it('attachDeadLetterAndAlerting does not throw when DLQ enqueue itself fails (logs only)', async () => {
    const enqueueFailure = new Error('redis-down');
    queueAddMock.mockReset();
    queueAddMock.mockRejectedValue(enqueueFailure);

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const { attachDeadLetterAndAlerting } = await import(
        '@/infrastructure/queue/dlq/dead-letter.js'
      );
      const fakeWorker = new EventEmitter() as unknown as Worker;
      attachDeadLetterAndAlerting(fakeWorker, 'mail');

      const job = buildJob({ id: 'job-enqueue-fail' });
      const finalError = new Error('handler-final');

      expect(() => {
        fakeWorker.emit('failed', job, finalError, 'active');
      }).not.toThrow();

      await vi.waitFor(() => {
        expect(queueAddMock).toHaveBeenCalledTimes(1);
      });
      /** Allow the swallowed `.catch()` callback to run before asserting no unhandled rejection. */
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandledRejections).toEqual([]);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('dead-letter hook for final failure captures Sentry exactly once', async () => {
    const { attachDeadLetterAndAlerting } = await import(
      '@/infrastructure/queue/dlq/dead-letter.js'
    );
    const fakeWorker = new EventEmitter() as unknown as Worker;
    attachDeadLetterAndAlerting(fakeWorker, 'notification');

    const finalError = new Error('boom');
    const job = buildJob({ id: 'job-sentry-once', attemptsMade: 3, opts: { attempts: 3 } });

    fakeWorker.emit('failed', job, finalError, 'active');

    await vi.waitFor(() => {
      expect(queueAddMock).toHaveBeenCalledTimes(1);
    });

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(finalError);
  });
});
