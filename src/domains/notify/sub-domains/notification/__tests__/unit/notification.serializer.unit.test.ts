import { describe, expect, it } from 'vitest';
import { NotificationSerializer } from '@/domains/notify/sub-domains/notification/notification.serializer.js';

describe('notification serializer', () => {
  it('NotificationSerializer maps public_id → id and drops bigserials (sec-T #17)', () => {
    const input = {
      id: 17,
      public_id: 'notif_public_id_xxxxx',
      user_id: 42,
      organization_id: 7,
      type: 'security.alert',
      title: 'New sign-in',
      message: 'A new device signed in to your account.',
      data: { device: 'iPhone' },
      action_url: 'https://example.com/sessions',
      action_label: 'Review',
      is_read: false,
      read_at: null,
      created_at: '2026-06-06T00:00:00.000Z',
    };

    const out = NotificationSerializer.one(input as never);

    expect(out).toEqual({
      id: 'notif_public_id_xxxxx',
      type: 'security.alert',
      title: 'New sign-in',
      message: 'A new device signed in to your account.',
      data: { device: 'iPhone' },
      action_url: 'https://example.com/sessions',
      action_label: 'Review',
      is_read: false,
      read_at: null,
      created_at: '2026-06-06T00:00:00.000Z',
    });
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('organization_id');
    expect(NotificationSerializer.many([input as never])).toEqual([out]);
  });
});
