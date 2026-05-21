import { describe, expect, it } from 'vitest';
import {
  serializeUserNotificationPreference,
  serializeUserNotificationPreferenceList,
} from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.serializer.js';

describe('user-notification-preferences.serializer edge cases', () => {
  it('preserves null organization_id separately from row id', () => {
    const result = serializeUserNotificationPreference({
      id: 17,
      notification_type: 'security.alert',
      channel: 'email',
      organization_id: null,
      is_enabled: true,
    });

    expect(result.id).toBe(17);
    expect(result.organization_id).toBeNull();
  });

  it('preserves scoped organization_id distinct from row id', () => {
    const result = serializeUserNotificationPreference({
      id: 5,
      notification_type: 'billing.invoice',
      channel: 'email',
      organization_id: 99,
      is_enabled: true,
    });

    expect(result.id).toBe(5);
    expect(result.organization_id).toBe(99);
  });

  it('preserves enabled=false rows (does not drop them)', () => {
    const rows = [
      { id: 1, notification_type: 'a', channel: 'email', organization_id: null, is_enabled: false },
      { id: 2, notification_type: 'b', channel: 'email', organization_id: null, is_enabled: true },
      { id: 3, notification_type: 'c', channel: 'email', organization_id: 7, is_enabled: false },
    ];

    const result = serializeUserNotificationPreferenceList(rows);

    expect(result).toHaveLength(3);
    expect(result.map((row) => row.is_enabled)).toEqual([false, true, false]);
  });

  it('single row serializer keeps is_enabled=false untouched', () => {
    const result = serializeUserNotificationPreference({
      id: 8,
      notification_type: 'security.alert',
      channel: 'in_app',
      organization_id: null,
      is_enabled: false,
    });

    expect(result.is_enabled).toBe(false);
  });
});
