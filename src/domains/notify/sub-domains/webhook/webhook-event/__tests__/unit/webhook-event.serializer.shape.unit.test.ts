import { describe, expect, it } from 'vitest';
import {
  serializeWebhookEvent,
  serializeWebhookEventList,
} from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.serializer.js';
import type { WebhookEvent } from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.types.js';

describe('webhook-event.serializer shape (regression-guard)', () => {
  const sampleEvent: WebhookEvent = {
    event: 'organization.member.invited',
    description: 'Emitted when a member is invited to the organization.',
  };

  it('serializeWebhookEvent exposes only event and description fields', () => {
    const result = serializeWebhookEvent(sampleEvent);
    expect(Object.keys(result).sort()).toEqual(['description', 'event']);
    expect(result.event).toBe(sampleEvent.event);
    expect(result.description).toBe(sampleEvent.description);
  });

  it('serializeWebhookEvent omits internal fields injected on the input row', () => {
    const eventWithExtras = {
      ...sampleEvent,
      id: 42,
      created_at: '2026-01-01T00:00:00.000Z',
      internal_secret: 'should-not-leak',
    } as WebhookEvent;
    const result = serializeWebhookEvent(eventWithExtras);
    expect(Object.keys(result).sort()).toEqual(['description', 'event']);
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('created_at');
    expect(result).not.toHaveProperty('internal_secret');
  });

  it('serializeWebhookEventList preserves order and shape for each entry', () => {
    const events: WebhookEvent[] = [
      { event: 'a.created', description: 'A' },
      { event: 'b.updated', description: 'B' },
      { event: 'c.deleted', description: 'C' },
    ];
    const result = serializeWebhookEventList(events);
    expect(result.map((entry) => entry.event)).toEqual(['a.created', 'b.updated', 'c.deleted']);
    expect(result.every((entry) => Object.keys(entry).sort().join() === 'description,event')).toBe(
      true,
    );
  });
});
