import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Worker } from 'bullmq';
import type { DeadLetterJobData } from '@/infrastructure/queue/dlq/dead-letter.js';

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
const insertDeadLetterJobMock = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    constructor(name: string, options: unknown) {
      queueConstructorMock(name, options);
    }

    add = queueAddMock;

    close = queueCloseMock;
  },
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

vi.mock('@/infrastructure/queue/dlq/dead-letter.repository.js', () => ({
  insertDeadLetterJob: (...arguments_: unknown[]) => insertDeadLetterJobMock(...arguments_),
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
    insertDeadLetterJobMock.mockClear();
    insertDeadLetterJobMock.mockResolvedValue(undefined);
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

  it('captures the replay keys for webhook, stripe, and notification jobs (bug 43)', async () => {
    const { enqueueDeadLetter } = await import('@/infrastructure/queue/dlq/dead-letter.js');
    const { buildReplayJobPayload } = await import('@/infrastructure/queue/dlq/dlq-replay.util.js');
    const { WEBHOOK_DELIVERY_QUEUE_NAME } = await import(
      '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js'
    );
    const { STRIPE_WEBHOOK_QUEUE_NAME } = await import(
      '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js'
    );
    const { NOTIFICATION_QUEUE_NAME } = await import(
      '@/domains/notify/sub-domains/notification/queues/notification.queue.js'
    );

    const cases = [
      {
        queue: WEBHOOK_DELIVERY_QUEUE_NAME,
        jobName: 'deliver-webhook',
        data: {
          deliveryAttemptId: 9,
          organizationPublicId: 'org_public_abc',
          requestId: 'req-1',
          secret: 'should-not-be-captured',
        },
        expectedSummary: {
          delivery_attempt_id: 9,
          organization_public_id: 'org_public_abc',
        },
        expectedReplay: { deliveryAttemptId: 9, organizationPublicId: 'org_public_abc' },
      },
      {
        queue: STRIPE_WEBHOOK_QUEUE_NAME,
        jobName: 'process-stripe-webhook',
        data: { stripeEventId: 'evt_123', requestId: 'req-2' },
        expectedSummary: { stripe_event_id: 'evt_123' },
        expectedReplay: { stripeEventId: 'evt_123' },
      },
      {
        queue: NOTIFICATION_QUEUE_NAME,
        jobName: 'dispatch-notification',
        data: { notificationId: 77, organizationPublicId: 'org_public_xyz', requestId: 'req-3' },
        expectedSummary: { notification_id: 77, organization_public_id: 'org_public_xyz' },
        expectedReplay: { notificationId: 77, organizationPublicId: 'org_public_xyz' },
      },
    ];

    for (const testCase of cases) {
      queueAddCalls.length = 0;
      await enqueueDeadLetter(
        testCase.queue,
        buildJob({ id: `job-${testCase.queue}`, name: testCase.jobName, data: testCase.data }),
        new Error('boom'),
      );

      const [{ data }] = queueAddCalls as [QueueAddCall];
      const summary = data.original_data_summary as Record<string, unknown>;
      expect(summary).toMatchObject(testCase.expectedSummary);
      // Secrets/PII beyond the replay keys must never reach the DLQ summary.
      expect(summary.secret).toBeUndefined();

      const replayPayload = buildReplayJobPayload(data as unknown as DeadLetterJobData);
      expect(replayPayload).not.toBeNull();
      expect(replayPayload).toMatchObject(testCase.expectedReplay);
    }
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
