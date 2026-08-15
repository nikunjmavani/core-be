import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The user domain's only BullMQ producer, previously untested. What matters is that the payload is
 * re-validated on the way in — a malformed job must fail at the enqueue call site, where the
 * request can still surface an error, rather than landing in Redis and failing later in the worker.
 */
const addMock = vi.fn().mockResolvedValue(undefined);
const closeMock = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: class {
    add = addMock;
    close = closeMock;
    waitUntilReady = vi.fn().mockResolvedValue(undefined);
    getJobCounts = vi.fn().mockResolvedValue({});
  },
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQProducerConnectionOptions: () => ({}),
}));

vi.mock('@/infrastructure/observability/tracing/trace-context.util.js', () => ({
  captureTraceContextForPropagation: () => ({ traceparent: '00-trace-span-01' }),
}));

import {
  USER_DATA_EXPORT_QUEUE_NAME,
  closeUserDataExportQueue,
  enqueueUserDataExport,
} from '@/domains/user/sub-domains/user-data-export/queues/user-data-export.queue.js';

const JOB_DATA = {
  exportPublicId: 'ude_aaaaaaaaaaaaaaaaaaaaa',
  userPublicId: 'usr_bbbbbbbbbbbbbbbbbbbbb',
  userInternalId: 42,
};

describe('user-data-export.queue', () => {
  beforeEach(() => {
    addMock.mockClear();
    closeMock.mockClear();
  });

  it('exposes a stable queue name shared with the worker', () => {
    expect(USER_DATA_EXPORT_QUEUE_NAME).toBe('user-data-export');
  });

  it('adds a process-user-data-export job carrying the export and user identifiers', async () => {
    await enqueueUserDataExport(JOB_DATA);

    expect(addMock).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = addMock.mock.calls[0]!;
    expect(jobName).toBe('process-user-data-export');
    expect(jobData).toMatchObject(JOB_DATA);
  });

  it('stamps the captured trace context onto the payload so the worker span links back', async () => {
    await enqueueUserDataExport(JOB_DATA);

    const [, jobData] = addMock.mock.calls[0]!;
    expect(jobData).toMatchObject({ traceparent: '00-trace-span-01' });
  });

  it('rejects a malformed payload before it reaches Redis', async () => {
    await expect(
      enqueueUserDataExport({ ...JOB_DATA, userInternalId: -1 } as never),
    ).rejects.toThrow();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('closes the queue client and tolerates a second close during shutdown', async () => {
    await enqueueUserDataExport(JOB_DATA);

    await closeUserDataExportQueue();
    expect(closeMock).toHaveBeenCalledTimes(1);

    // The singleton is nulled on close, so a repeated shutdown must be a no-op, not a throw.
    await expect(closeUserDataExportQueue()).resolves.toBeUndefined();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
