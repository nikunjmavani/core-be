import { describe, expect, it } from 'vitest';
import { NotificationSerializer } from '@/domains/notify/sub-domains/notification/notification.serializer.js';

describe('notification.serializer shape (regression-guard)', () => {
  it('NotificationSerializer.one preserves read_at when null (unread notification)', () => {
    const notification = {
      id: 'notif_01',
      type: 'invitation',
      channel: 'email',
      is_read: false,
      read_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const result = NotificationSerializer.one(notification);
    expect(result.read_at).toBeNull();
    expect(result.is_read).toBe(false);
  });

  it('NotificationSerializer.one preserves read_at when a Date instance (read notification)', () => {
    const readAt = new Date('2026-01-02T03:04:05.000Z');
    const notification = {
      id: 'notif_02',
      type: 'webhook.failure',
      channel: 'in_app',
      is_read: true,
      read_at: readAt,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const result = NotificationSerializer.one(notification);
    expect(result.read_at).toBe(readAt);
    expect(result.is_read).toBe(true);
  });

  it('NotificationSerializer.one passes channel and type fields through unchanged', () => {
    const notification = {
      id: 'notif_03',
      type: 'organization.invitation',
      channel: 'email',
      title: 'You have been invited',
      body: 'hello',
    };
    const result = NotificationSerializer.one(notification);
    expect(result.type).toBe('organization.invitation');
    expect(result.channel).toBe('email');
    expect(result.title).toBe('You have been invited');
    expect(result.body).toBe('hello');
  });
});
