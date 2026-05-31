import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordUnhandledRejectionMock = vi.fn();
const captureExceptionMock = vi.fn();
const flushSentryMock = vi.fn().mockResolvedValue(undefined);
const loggerErrorMock = vi.fn();
const loggerFatalMock = vi.fn();

vi.mock('@/infrastructure/observability/metrics/prometheus-metrics.js', () => ({
  recordUnhandledRejection: (...arguments_: unknown[]) =>
    recordUnhandledRejectionMock(...arguments_),
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureException: (...arguments_: unknown[]) => captureExceptionMock(...arguments_),
  flushSentry: () => flushSentryMock(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: {
    error: (...arguments_: unknown[]) => loggerErrorMock(...arguments_),
    fatal: (...arguments_: unknown[]) => loggerFatalMock(...arguments_),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { createUnhandledRejectionHandler } from '@/infrastructure/observability/unhandled-rejection.handler.js';

describe('createUnhandledRejectionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('meters, captures, and logs each non-fatal rejection with the api process label', () => {
    const handler = createUnhandledRejectionHandler({
      process: 'api',
      sentrySource: 'unhandledRejection',
    });

    handler(new Error('boom'));

    expect(recordUnhandledRejectionMock).toHaveBeenCalledTimes(1);
    expect(recordUnhandledRejectionMock).toHaveBeenCalledWith('api');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerFatalMock).not.toHaveBeenCalled();
  });

  it('meters with the worker process label for worker handlers', () => {
    const handler = createUnhandledRejectionHandler({
      process: 'worker',
      sentrySource: 'worker_unhandledRejection',
    });

    handler(new Error('worker-boom'));

    expect(recordUnhandledRejectionMock).toHaveBeenCalledWith('worker');
    expect(loggerFatalMock).not.toHaveBeenCalled();
  });

  it('escalates to a fatal exit once the sustained burst threshold is reached', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as typeof process.exit);
    const handler = createUnhandledRejectionHandler({
      process: 'api',
      sentrySource: 'unhandledRejection',
    });

    for (let index = 0; index < 20; index += 1) {
      handler(new Error('burst'));
    }

    expect(recordUnhandledRejectionMock).toHaveBeenCalledTimes(20);
    expect(loggerFatalMock).toHaveBeenCalledTimes(1);
    /** The fatal exit runs after `flushSentry().finally(...)` resolves — flush microtasks
     * before restoring the spy so the real (vitest-patched) `process.exit` is not hit. */
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    exitSpy.mockRestore();
  });
});
