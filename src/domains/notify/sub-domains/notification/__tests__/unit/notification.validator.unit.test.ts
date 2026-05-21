import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateListNotificationsQuery } from '@/domains/notify/sub-domains/notification/notification.validator.js';

describe('notification.validator', () => {
  it('validateListNotificationsQuery accepts limit within bounds', () => {
    expect(validateListNotificationsQuery({ limit: 50 })).toEqual({ limit: 50 });
  });

  it('validateListNotificationsQuery applies default limit when omitted', () => {
    expect(validateListNotificationsQuery({})).toEqual({ limit: 25 });
  });

  it('validateListNotificationsQuery throws for limit above max', () => {
    expect(() => validateListNotificationsQuery({ limit: 200 })).toThrow(ValidationError);
  });

  it('validateListNotificationsQuery throws for unknown keys', () => {
    expect(() => validateListNotificationsQuery({ limit: 10, unexpected: true })).toThrow(
      ValidationError,
    );
  });
});
