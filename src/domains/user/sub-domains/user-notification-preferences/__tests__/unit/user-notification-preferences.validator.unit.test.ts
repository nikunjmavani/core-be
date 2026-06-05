import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validatePutUserNotificationPreferences } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.validator.js';

describe('user-notification-preferences.validator', () => {
  it('validatePutUserNotificationPreferences accepts preferences array', () => {
    const input = {
      preferences: [
        {
          notification_type: 'billing',
          channel: 'EMAIL',
          is_enabled: true,
        },
      ],
    };
    expect(validatePutUserNotificationPreferences(input)).toEqual(input);
  });

  it('validatePutUserNotificationPreferences rejects invalid preferences shape', () => {
    expect(() =>
      validatePutUserNotificationPreferences({ preferences: [{ notification_type: 'x' }] }),
    ).toThrow(ValidationError);
  });

  it('validatePutUserNotificationPreferences rejects a channel outside the allowed set', () => {
    // An unknown channel must be rejected at the edge (422), not slip through to the
    // chk_user_notif_prefs_channel database check and surface as a 500.
    expect(() =>
      validatePutUserNotificationPreferences({
        preferences: [{ notification_type: 'billing', channel: 'TELEPATHY', is_enabled: true }],
      }),
    ).toThrow(ValidationError);
  });
});
