import { describe, expect, it } from 'vitest';
import { NotificationSerializer } from '@/domains/notify/sub-domains/notification/notification.serializer.js';

// sec-T #17: serializer is now typed strip-only. The Drizzle row shape is the
// documented input; output is `{ id, type, title, message, data, action_url,
// action_label, is_read, read_at, created_at }` — `channel`/`body` are not part
// of the table schema and never appeared in production responses. Tests use
// `public_id` as input and assert `id` on output.
function makeNotificationRow(overrides: Record<string, unknown> = {}) {
  return {
    public_id: 'notif_publicpublicpubl',
    type: 'invitation',
    title: 'You have been invited',
    message: 'hello',
    data: {},
    action_url: null,
    action_label: null,
    is_read: false,
    read_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as never;
}

describe('notification.serializer shape (regression-guard)', () => {
  it('NotificationSerializer.one preserves read_at when null (unread notification)', () => {
    const result = NotificationSerializer.one(
      makeNotificationRow({ is_read: false, read_at: null }),
    );
    expect(result.read_at).toBeNull();
    expect(result.is_read).toBe(false);
  });

  it('NotificationSerializer.one converts read_at Date to ISO string (read notification)', () => {
    const readAt = new Date('2026-01-02T03:04:05.000Z');
    const result = NotificationSerializer.one(
      makeNotificationRow({ is_read: true, read_at: readAt }),
    );
    // sec-T #17: Date instances are serialised to ISO strings for the public API.
    expect(result.read_at).toBe('2026-01-02T03:04:05.000Z');
    expect(result.is_read).toBe(true);
  });

  it('NotificationSerializer.one passes type/title/message fields through unchanged', () => {
    const result = NotificationSerializer.one(
      makeNotificationRow({ type: 'organization.invitation', message: 'hello body' }),
    );
    expect(result.type).toBe('organization.invitation');
    expect(result.title).toBe('You have been invited');
    expect(result.message).toBe('hello body');
  });

  it('NotificationSerializer.one maps public_id → id and drops bigserials (sec-T #17)', () => {
    const result = NotificationSerializer.one(
      makeNotificationRow({ public_id: 'notif_publicpublicpubl' }),
    );
    expect(result.id).toBe('notif_publicpublicpubl');
    expect(result).not.toHaveProperty('user_id');
    expect(result).not.toHaveProperty('organization_id');
  });
});
