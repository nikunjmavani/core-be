import { describe, expect, it } from 'vitest';
import {
  WebhookDeliveryAttemptSerializer,
  WebhookSerializer,
} from '@/domains/notify/sub-domains/webhook/webhook.serializer.js';
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

  // sec-r4-D6: WebhookDeliveryAttemptSerializer.many MUST NOT include
  // `payload` or `response_body` — those carry the full outbound event body
  // and the customer's HTTP response, which broaden the disclosure surface
  // unnecessarily for every list-row response.
  it('WebhookDeliveryAttemptSerializer.many omits payload and response_body (sec-r4-D6)', () => {
    const listRow = {
      event_type: 'user.created',
      event_key: 'usr_abc',
      status: 'SENT',
      http_status_code: 200,
      sent_at: '2026-06-06T00:00:00.000Z',
      attempt_count: 1,
      next_retry_at: null,
      created_at: '2026-06-06T00:00:00.000Z',
    };
    const out = WebhookDeliveryAttemptSerializer.many([listRow]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty('payload');
    expect(out[0]).not.toHaveProperty('response_body');
    expect(out[0]).toEqual({
      event_type: 'user.created',
      event_key: 'usr_abc',
      status: 'SENT',
      http_status_code: 200,
      sent_at: '2026-06-06T00:00:00.000Z',
      attempt_count: 1,
      next_retry_at: null,
      created_at: '2026-06-06T00:00:00.000Z',
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
