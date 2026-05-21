import { describe, it, expect, vi } from 'vitest';
import { WebhookEventService } from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.service.js';
import type { WebhookEventRepository } from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.repository.js';

describe('WebhookEventService', () => {
  it('lists webhook events', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue([{ id: 1, event_type: 'billing.subscription.updated' }]),
    } as unknown as WebhookEventRepository;

    const service = new WebhookEventService(repository);
    const events = await service.list();

    expect(repository.list).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
  });
});
