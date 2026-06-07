import { beforeEach, describe, expect, it, vi } from 'vitest';

const listStaleMock = vi.fn();
const consumeTasksMock = vi.fn();
vi.mock('@/infrastructure/queue/commit-dispatch/commit-dispatch.store.js', () => ({
  COMMIT_DISPATCH_RECOVERY_AFTER_MS: 30_000,
  listStaleCommitDispatchRequestIds: (...args: unknown[]) => listStaleMock(...args),
  consumeCommitDispatchTasks: (...args: unknown[]) => consumeTasksMock(...args),
}));

const executeTaskMock = vi.fn();
vi.mock('@/infrastructure/queue/commit-dispatch/commit-dispatch.executor.js', () => ({
  executeCommitDispatchTask: (...args: unknown[]) => executeTaskMock(...args),
}));

const captureExceptionMock = vi.fn();
const isSentryInitializedMock = vi.fn().mockReturnValue(true);
vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  isSentryInitialized: () => isSentryInitializedMock(),
  Sentry: { captureException: (...args: unknown[]) => captureExceptionMock(...args) },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/shared/constants/limits.constants.js', () => ({
  DEFAULT_COMMIT_DISPATCH_RECOVERY_BATCH_SIZE: 10,
}));

import { runCommitDispatchRecoveryJob } from '@/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.processor.js';

describe('runCommitDispatchRecoveryJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSentryInitializedMock.mockReturnValue(true);
  });

  it('returns zero counts when no stale request ids', async () => {
    listStaleMock.mockResolvedValue([]);
    const result = await runCommitDispatchRecoveryJob();
    expect(result).toEqual({ scannedCount: 0, executedCount: 0 });
    expect(executeTaskMock).not.toHaveBeenCalled();
  });

  it('executes tasks for each stale request id and counts successes', async () => {
    listStaleMock.mockResolvedValue(['req-1']);
    consumeTasksMock.mockResolvedValue([{ type: 'enqueue', payload: {} }]);
    executeTaskMock.mockResolvedValue(undefined);

    const result = await runCommitDispatchRecoveryJob();
    expect(result).toEqual({ scannedCount: 1, executedCount: 1 });
    expect(executeTaskMock).toHaveBeenCalledTimes(1);
  });

  it('sec-new-Q2: captures exception in Sentry when a task fails and Sentry is initialized', async () => {
    const taskError = new Error('task execution failed');
    listStaleMock.mockResolvedValue(['req-1']);
    consumeTasksMock.mockResolvedValue([{ type: 'enqueue', payload: {} }]);
    executeTaskMock.mockRejectedValue(taskError);

    const result = await runCommitDispatchRecoveryJob();

    // Task failure should not interrupt the batch — scanned = 1, executed = 0.
    expect(result).toEqual({ scannedCount: 1, executedCount: 0 });
    expect(captureExceptionMock).toHaveBeenCalledWith(taskError);
  });

  it('sec-new-Q2: skips Sentry capture when Sentry is not initialized', async () => {
    isSentryInitializedMock.mockReturnValue(false);
    const taskError = new Error('task execution failed');
    listStaleMock.mockResolvedValue(['req-1']);
    consumeTasksMock.mockResolvedValue([{ type: 'enqueue', payload: {} }]);
    executeTaskMock.mockRejectedValue(taskError);

    await runCommitDispatchRecoveryJob();

    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('continues processing remaining tasks after a per-task failure', async () => {
    const taskError = new Error('first task failed');
    listStaleMock.mockResolvedValue(['req-1']);
    consumeTasksMock.mockResolvedValue([
      { type: 'enqueue', payload: { a: 1 } },
      { type: 'enqueue', payload: { b: 2 } },
    ]);
    executeTaskMock.mockRejectedValueOnce(taskError).mockResolvedValueOnce(undefined);

    const result = await runCommitDispatchRecoveryJob();

    // Second task succeeded despite first failing.
    expect(result).toEqual({ scannedCount: 1, executedCount: 1 });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(executeTaskMock).toHaveBeenCalledTimes(2);
  });
});
