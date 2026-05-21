import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validatePutUserNotificationPreferences } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.validator.js';

describe('user-notification-preferences.validator', () => {
  it('validatePutUserNotificationPreferences accepts preferences array', () => {
    const input = {
      preferences: [
        {
          notification_type: 'billing',
          channel: 'email',
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
});
