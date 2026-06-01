import { describe, it, expect, vi, beforeEach } from 'vitest';

const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = addMock;
    close = vi.fn();
    client = Promise.resolve({ ping: async () => 'PONG' });
  },
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({}),
  getBullMQProducerConnectionOptions: () => ({ enableOfflineQueue: false }),
}));

describe('Integration: trace context propagation to BullMQ', () => {
  beforeEach(async () => {
    addMock.mockClear();
    vi.resetModules();
  });

  it('should include requestId in notification job payload when provided', async () => {
    const { enqueueNotification } = await import(
      '@/domains/notify/sub-domains/notification/queues/notification.queue.js'
    );
    await enqueueNotification(42, 'org_public_123', 'req-correlation-abc');

    expect(addMock).toHaveBeenCalledWith(
      'dispatch-notification',
      expect.objectContaining({
        notificationId: 42,
        organizationPublicId: 'org_public_123',
        requestId: 'req-correlation-abc',
      }),
    );
  });
});
