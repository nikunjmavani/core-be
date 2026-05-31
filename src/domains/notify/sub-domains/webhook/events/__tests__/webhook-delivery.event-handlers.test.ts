import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import { NOTIFY_EVENT } from '@/domains/notify/sub-domains/webhook/events/notify.events.js';
import { registerWebhookDeliveryEventHandlers } from '@/domains/notify/sub-domains/webhook/events/webhook-delivery.event-handlers.js';

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
  beforeEach(() => {
    enqueueWebhookDeliveryByAttemptIdMock.mockReset();
    findOrganizationPublicIdByDeliveryAttemptIdMock.mockReset();
    findOrganizationPublicIdByDeliveryAttemptIdMock.mockResolvedValue('org_public_test_99');
    registerWebhookDeliveryEventHandlers();
  });

  it('defers webhook delivery enqueue until flushOnCommit', async () => {
    enterOnCommitScope();
    await eventBus.emit({
      type: NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED,
      payload: { delivery_attempt_id: 99 },
      timestamp: new Date(),
    });

    expect(enqueueWebhookDeliveryByAttemptIdMock).not.toHaveBeenCalled();

    await eventBus.flushOnCommit();
    expect(enqueueWebhookDeliveryByAttemptIdMock).toHaveBeenCalledOnce();
    expect(enqueueWebhookDeliveryByAttemptIdMock).toHaveBeenCalledWith(99, 'org_public_test_99');
  });

  it('enqueues webhook delivery immediately when no HTTP onCommit scope is active', async () => {
    await eventBus.emit({
      type: NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED,
      payload: { delivery_attempt_id: 42 },
      timestamp: new Date(),
    });

    expect(enqueueWebhookDeliveryByAttemptIdMock).toHaveBeenCalledOnce();
    expect(enqueueWebhookDeliveryByAttemptIdMock).toHaveBeenCalledWith(42, 'org_public_test_99');
  });
});
