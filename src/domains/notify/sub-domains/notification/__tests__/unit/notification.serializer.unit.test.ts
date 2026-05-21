import { describe, expect, it } from 'vitest';
import { NotificationSerializer } from '@/domains/notify/sub-domains/notification/notification.serializer.js';

describe('notification serializer', () => {
  it('NotificationSerializer is pass-through', () => {
    const notification = { id: 'n-1' };
    expect(NotificationSerializer.one(notification)).toBe(notification);
    expect(NotificationSerializer.many([notification])).toEqual([notification]);
  });
});
