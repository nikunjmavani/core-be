import { describe, expect, it } from 'vitest';
import { WebhookSerializer } from '@/domains/notify/sub-domains/webhook/webhook.serializer.js';
import {
  serializeWebhookEvent,
  serializeWebhookEventList,
} from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.serializer.js';

describe('webhook serializers', () => {
  it('WebhookSerializer preserves non-secret fields for one and many', () => {
    const webhook = { id: 'wh-1', url: 'https://example.com' };
    expect(WebhookSerializer.one(webhook)).toEqual(webhook);
    expect(WebhookSerializer.many([webhook])).toEqual([webhook]);
  });

  it('serializeWebhookEvent maps event fields', () => {
    expect(serializeWebhookEvent({ event: 'user.created', description: 'User created' })).toEqual({
      event: 'user.created',
      description: 'User created',
    });
  });

  it('serializeWebhookEventList maps all events', () => {
    const events = [
      { event: 'a', description: 'A' },
      { event: 'b', description: 'B' },
    ];
    expect(serializeWebhookEventList(events)).toEqual([
      { event: 'a', description: 'A' },
      { event: 'b', description: 'B' },
    ]);
  });
});
