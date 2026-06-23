import { beforeEach, describe, expect, it, vi } from 'vitest';

const addMock = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: class {
    add = addMock;
    waitUntilReady = vi.fn().mockResolvedValue(undefined);
    getJobCounts = vi.fn().mockResolvedValue({});
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQProducerConnectionOptions: () => ({}),
}));

vi.mock('@/infrastructure/observability/tracing/trace-context.util.js', () => ({
  captureTraceContextForPropagation: () => ({}),
}));

import { enqueueNotification } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';

describe('enqueueNotification', () => {
  beforeEach(() => {
    addMock.mockClear();
  });

  // audit #6: the enqueue must be idempotent on the notification id so a
  // recovery/redelivery path cannot dispatch (and email) the same notification
  // twice.
  it('adds the job with a notification-id-scoped jobId for dedup', async () => {
    await enqueueNotification(123, 'org_public_id', 'request-1');

    expect(addMock).toHaveBeenCalledTimes(1);
    const [jobName, jobData, options] = addMock.mock.calls[0]!;
    expect(jobName).toBe('dispatch-notification');
    expect(jobData).toMatchObject({
      notificationId: 123,
      organizationPublicId: 'org_public_id',
      requestId: 'request-1',
    });
    expect(options).toEqual({ jobId: 'notification-123' });
  });

  it('derives the jobId from the notification id even for tenant-less notifications', async () => {
    await enqueueNotification(456, null);

    const [, jobData, options] = addMock.mock.calls[0]!;
    expect(jobData).toMatchObject({ notificationId: 456, organizationPublicId: null });
    expect(options).toEqual({ jobId: 'notification-456' });
  });
});
