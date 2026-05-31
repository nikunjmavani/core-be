import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events/event-bus.js';
import { NOTIFY_EVENT } from '@/domains/notify/sub-domains/webhook/events/notify.events.js';
import { emitWebhookDeliveryRequested } from '@/domains/notify/sub-domains/webhook/webhook-delivery/events/webhook-delivery-emit.js';

vi.mock(
  '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.repository.js',
  () => ({
    createPendingWebhookDeliveryAttempt: vi.fn().mockResolvedValue(99),
  }),
);

const emitSpy = vi.spyOn(eventBus, 'emit');

describe('webhook-delivery-emit', () => {
  beforeEach(() => {
    emitSpy.mockClear();
  });

  it('emitWebhookDeliveryRequested emits WEBHOOK_DELIVERY_REQUESTED', async () => {
    await emitWebhookDeliveryRequested({
      webhookId: 2,
      eventType: 'subscription.updated',
      payload: { id: 'inv_1' },
    });

    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED,
        payload: { delivery_attempt_id: 99 },
      }),
    );
  });
});
