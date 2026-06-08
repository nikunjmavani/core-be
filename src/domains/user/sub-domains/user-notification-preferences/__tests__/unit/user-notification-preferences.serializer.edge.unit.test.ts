import { describe, expect, it } from 'vitest';
import {
  serializeUserNotificationPreference,
  serializeUserNotificationPreferenceList,
} from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.serializer.js';

// sec-T finding #17: the serializer is now a strip-only allowlist that emits
// `(notification_type, channel, is_enabled)`. The bigserial `id` and bigint
// `organization_id` were dropped — preferences are addressed by
// `(notification_type, channel)`, the PUT endpoint replaces the full set, and
// no client needs a stable row id. The fixtures retain the wider input shape
// to exercise the regression: extra row fields must NOT leak through.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 17,
    notification_type: 'security.alert',
    channel: 'email',
    organization_id: null,
    is_enabled: true,
    ...overrides,
  } as never;
}

describe('user-notification-preferences.serializer edge cases', () => {
  it('drops internal `id` and `organization_id` from the public response (sec-T #17)', () => {
    const result = serializeUserNotificationPreference(makeRow({ id: 17, organization_id: null }));

    expect(result).toEqual({
      notification_type: 'security.alert',
      channel: 'email',
      is_enabled: true,
    });
    // Belt-and-braces: even when the input row carries a value, neither key
    // appears on the output.
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('organization_id');
  });

  it('drops `organization_id` even when populated (no organization-id echo)', () => {
    const result = serializeUserNotificationPreference(
      makeRow({ id: 5, organization_id: 99, notification_type: 'billing.invoice' }),
    );

    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('organization_id');
    expect(result.notification_type).toBe('billing.invoice');
  });

  it('preserves is_enabled=false rows (does not drop them)', () => {
    const rows = [
      makeRow({ id: 1, notification_type: 'a', is_enabled: false }),
      makeRow({ id: 2, notification_type: 'b', is_enabled: true }),
      makeRow({ id: 3, notification_type: 'c', organization_id: 7, is_enabled: false }),
    ];

    const result = serializeUserNotificationPreferenceList(rows);

    expect(result).toHaveLength(3);
    expect(result.map((row) => row.is_enabled)).toEqual([false, true, false]);
  });

  it('single row serializer keeps is_enabled=false untouched', () => {
    const result = serializeUserNotificationPreference(
      makeRow({ id: 8, channel: 'in_app', is_enabled: false }),
    );

    expect(result.is_enabled).toBe(false);
  });
});
