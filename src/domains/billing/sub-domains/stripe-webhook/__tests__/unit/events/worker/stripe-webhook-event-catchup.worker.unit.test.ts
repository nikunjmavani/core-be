import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker-wiring parity: the reclaim and retention workers each have a suite pinning the queue
 * name, concurrency, and runtime options; the catch-up worker had only a *processor* test. The
 * gap matters because the processor test never constructs a `Worker` — a regression that bound
 * the catch-up processor to the wrong queue name, or dropped the retention concurrency of 1
 * (letting several catch-up sweeps list Stripe events concurrently and re-enqueue duplicates),
 * would ship green.
 */
const workerState = vi.hoisted(() => ({
  queueName: undefined as string | undefined,
  processor: undefined as (() => Promise<unknown>) | undefined,
  options: undefined as Record<string, unknown> | undefined,
  listeners: new Map<string, (...arguments_: unknown[]) => void>(),
}));

const runStripeWebhookEventCatchupJobMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn(),
  UnrecoverableError: class UnrecoverableError extends Error {},
  Worker: vi.fn().mockImplementation(function WorkerMock(queueName, processor, options) {
    workerState.queueName = queueName;
    workerState.processor = processor;
    workerState.options = options;
    return {
      on: (event: string, listener: (...arguments_: unknown[]) => void) => {
        workerState.listeners.set(event, listener);
      },
      close: vi.fn(),
    };
  }),
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({ host: 'redis.test' }),
  getBullMQProducerConnectionOptions: () => ({ host: 'redis.test', enableOfflineQueue: false }),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (worker: unknown, queueName: string) => ({
    worker,
    queueName,
    close: async () => undefined,
  }),
}));

vi.mock(
  '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.processor.js',
  () => ({
    runStripeWebhookEventCatchupJob: (...arguments_: unknown[]) =>
      runStripeWebhookEventCatchupJobMock(...arguments_),
  }),
);

vi.mock('@/shared/config/env.config.js', () => ({
  env: { LOG_LEVEL: 'silent' },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: loggerWarnMock, error: vi.fn(), debug: vi.fn() },
}));

describe('stripe-webhook-event-catchup.worker', () => {
  let createStripeWebhookEventCatchupWorker: typeof import('@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.worker.js').createStripeWebhookEventCatchupWorker;

  beforeAll(async () => {
    ({ createStripeWebhookEventCatchupWorker } = await import(
      '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.worker.js'
    ));
  }, 60_000);

  beforeEach(() => {
    workerState.queueName = undefined;
    workerState.processor = undefined;
    workerState.options = undefined;
    workerState.listeners.clear();
    runStripeWebhookEventCatchupJobMock.mockReset();
    loggerWarnMock.mockReset();
    runStripeWebhookEventCatchupJobMock.mockResolvedValue({ enqueuedCount: 2 });
  });

  it('binds to the stripe-webhook-event-catchup queue at retention concurrency', () => {
    const handle = createStripeWebhookEventCatchupWorker();

    expect(workerState.queueName).toBe('stripe-webhook-event-catchup');
    expect(handle.queueName).toBe('stripe-webhook-event-catchup');
    // RETENTION_WORKER_CONCURRENCY — a cron sweep that lists Stripe events and diffs them
    // against the ledger must not run concurrently with itself.
    expect(workerState.options).toEqual(expect.objectContaining({ concurrency: 1 }));
  });

  it('uses the retention runtime options and the shared BullMQ connection', () => {
    createStripeWebhookEventCatchupWorker();

    expect(workerState.options).toEqual(
      expect.objectContaining({
        connection: { host: 'redis.test' },
        maxStalledCount: 1,
        lockDuration: expect.any(Number),
        stalledInterval: expect.any(Number),
      }),
    );
  });

  it('delegates each job to runStripeWebhookEventCatchupJob and returns its result', async () => {
    createStripeWebhookEventCatchupWorker();

    const result = await workerState.processor?.();

    expect(runStripeWebhookEventCatchupJobMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ enqueuedCount: 2 });
  });

  it('propagates processor errors so BullMQ applies its retry/backoff', async () => {
    createStripeWebhookEventCatchupWorker();
    runStripeWebhookEventCatchupJobMock.mockRejectedValue(new Error('stripe events.list failed'));

    await expect(workerState.processor?.()).rejects.toThrow('stripe events.list failed');
  });

  it('warn-logs stalled jobs with the queue name', () => {
    createStripeWebhookEventCatchupWorker();

    workerState.listeners.get('stalled')?.('job-42');

    expect(loggerWarnMock).toHaveBeenCalledWith(
      { jobId: 'job-42', queue: 'stripe-webhook-event-catchup' },
      'stripe-webhook-event-catchup.stalled',
    );
  });
});
