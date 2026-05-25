import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueWebhookDeliveryByAttemptIdMock = vi.fn();
const findOrganizationPublicIdByDeliveryAttemptIdMock = vi.fn();

vi.mock('@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js', () => ({
  enqueueWebhookDeliveryByAttemptId: (...arguments_: unknown[]) =>
    enqueueWebhookDeliveryByAttemptIdMock(...arguments_),
}));

vi.mock('@/domains/notify/sub-domains/webhook/webhook-delivery.repository.js', () => ({
  findOrganizationPublicIdByDeliveryAttemptId: (...arguments_: unknown[]) =>
    findOrganizationPublicIdByDeliveryAttemptIdMock(...arguments_),
}));

describe('webhook delivery event handlers', () => {
  beforeEach(async () => {
    enqueueWebhookDeliveryByAttemptIdMock.mockReset();
    findOrganizationPublicIdByDeliveryAttemptIdMock.mockReset();
    findOrganizationPublicIdByDeliveryAttemptIdMock.mockResolvedValue('org_public_test_99');
    vi.resetModules();
  });

  it('enqueues webhook delivery on notify.webhook_delivery.requested', async () => {
    const { eventBus, runWithOnCommitScope } = await import('@/core/events/event-bus.js');
    const { NOTIFY_EVENT } = await import(
      '@/domains/notify/sub-domains/webhook/events/notify.events.js'
    );
    const { registerWebhookDeliveryEventHandlers } = await import(
      '@/domains/notify/sub-domains/webhook/events/webhook-delivery.event-handlers.js'
    );
    registerWebhookDeliveryEventHandlers();

    await runWithOnCommitScope(async () => {
      await eventBus.emit({
        type: NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED,
        payload: { delivery_attempt_id: 99 },
        timestamp: new Date(),
      });
      await eventBus.flushOnCommit();
    });

    expect(enqueueWebhookDeliveryByAttemptIdMock).toHaveBeenCalledOnce();
    expect(enqueueWebhookDeliveryByAttemptIdMock).toHaveBeenCalledWith(99, 'org_public_test_99');
  });
});
