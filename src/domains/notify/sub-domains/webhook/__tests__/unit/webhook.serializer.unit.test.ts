import { describe, expect, it } from 'vitest';
import { WebhookSerializer } from '@/domains/notify/sub-domains/webhook/webhook.serializer.js';
import {
  serializeWebhookEvent,
  serializeWebhookEventList,
} from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.serializer.js';

describe('webhook serializers', () => {
  it('WebhookSerializer maps public_id → id and drops bigserials/secret-bearing fields (sec-T #17)', () => {
    const webhook = {
      public_id: 'wh_publicpublicpublic1',
      url: 'https://example.com',
      events: ['user.created'],
      is_enabled: true,
      secret_rotated_at: null,
      created_at: '2026-06-06T00:00:00.000Z',
      updated_at: '2026-06-06T00:00:00.000Z',
    };
    const out = WebhookSerializer.one(webhook);
    expect(out).toEqual({
      id: 'wh_publicpublicpublic1',
      url: 'https://example.com',
      events: ['user.created'],
      is_enabled: true,
      secret_rotated_at: null,
      created_at: '2026-06-06T00:00:00.000Z',
      updated_at: '2026-06-06T00:00:00.000Z',
    });
    expect(WebhookSerializer.many([webhook])).toEqual([out]);
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
