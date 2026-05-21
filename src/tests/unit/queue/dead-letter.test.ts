import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Worker } from 'bullmq';

const queueAddMock = vi.fn().mockResolvedValue(undefined);
const queueCloseMock = vi.fn().mockResolvedValue(undefined);
const sentryCaptureExceptionMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
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

describe('dead-letter helpers', () => {
  afterEach(async () => {
    queueAddMock.mockClear();
    queueCloseMock.mockClear();
    sentryCaptureExceptionMock.mockClear();
    const { closeDeadLetterQueues } = await import('@/infrastructure/queue/dlq/dead-letter.js');
    await closeDeadLetterQueues();
    vi.resetModules();
  });

  describe('isFinalJobFailure', () => {
    it('returns false when job is undefined', async () => {
      const { isFinalJobFailure } = await import('@/infrastructure/queue/dlq/dead-letter.js');
      expect(isFinalJobFailure(undefined)).toBe(false);
    });

    it('returns false when attempts remain', async () => {
      const { isFinalJobFailure } = await import('@/infrastructure/queue/dlq/dead-letter.js');
      const job = {
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as Job;
      expect(isFinalJobFailure(job)).toBe(false);
    });

    it('returns true when attempts are exhausted', async () => {
      const { isFinalJobFailure } = await import('@/infrastructure/queue/dlq/dead-letter.js');
      const job = {
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as Job;
      expect(isFinalJobFailure(job)).toBe(true);
    });

    it('treats missing opts.attempts as 1', async () => {
      const { isFinalJobFailure } = await import('@/infrastructure/queue/dlq/dead-letter.js');
      const job = {
        attemptsMade: 1,
        opts: {},
      } as Job;
      expect(isFinalJobFailure(job)).toBe(true);
    });
  });

  describe('getDeadLetterQueueName', () => {
    it('appends -dlq suffix', async () => {
      const { getDeadLetterQueueName } = await import('@/infrastructure/queue/dlq/dead-letter.js');
      expect(getDeadLetterQueueName('mail')).toBe('mail-dlq');
    });
  });

  describe('attachDeadLetterAndAlerting', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('does not enqueue or alert on transient failure', async () => {
      const { attachDeadLetterAndAlerting } =
        await import('@/infrastructure/queue/dlq/dead-letter.js');
      const fakeWorker = new EventEmitter() as unknown as Worker;
      attachDeadLetterAndAlerting(fakeWorker, 'notification');

      const job = {
        id: 'job-1',
        name: 'dispatch-notification',
        data: { notificationId: 1 },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as Job;

      fakeWorker.emit('failed', job, new Error('transient'), 'active');

      await Promise.resolve();
      await Promise.resolve();

      expect(queueAddMock).not.toHaveBeenCalled();
      expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
    });

    it('enqueues dead letter and captures Sentry on final failure', async () => {
      const { attachDeadLetterAndAlerting } =
        await import('@/infrastructure/queue/dlq/dead-letter.js');
      const fakeWorker = new EventEmitter() as unknown as Worker;
      attachDeadLetterAndAlerting(fakeWorker, 'notification');

      const finalError = new Error('permanent');
      const job = {
        id: 'job-2',
        name: 'dispatch-notification',
        data: { notificationId: 2 },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as Job;

      fakeWorker.emit('failed', job, finalError, 'active');

      await vi.waitFor(() => {
        expect(queueAddMock).toHaveBeenCalledTimes(1);
      });

      expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(finalError);
    });
  });
});
