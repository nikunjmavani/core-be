import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY } from '@/shared/utils/http/pagination.util.js';
import { validateListNotificationsQuery } from '@/domains/notify/sub-domains/notification/notification.validator.js';

describe('notification.validator', () => {
  it('validateListNotificationsQuery accepts limit within bounds', () => {
    expect(validateListNotificationsQuery({ limit: 50 })).toEqual({
      limit: 50,
      include_total: 'false',
    });
  });

  it('validateListNotificationsQuery applies default limit when omitted', () => {
    expect(validateListNotificationsQuery({})).toEqual({ limit: 25, include_total: 'false' });
  });

  it('validateListNotificationsQuery accepts cursor and include_total opt-in', () => {
    expect(
      validateListNotificationsQuery({ limit: 10, after: 'cursor_prev', include_total: 'true' }),
    ).toEqual({ limit: 10, after: 'cursor_prev', include_total: 'true' });
  });

  it('validateListNotificationsQuery throws for limit above max', () => {
    expect(() => validateListNotificationsQuery({ limit: 200 })).toThrow(ValidationError);
  });

  it('validateListNotificationsQuery throws for unknown keys', () => {
    expect(() => validateListNotificationsQuery({ limit: 10, unexpected: true })).toThrow(
      ValidationError,
    );
  });

  it('validateListNotificationsQuery rejects legacy page query parameter', () => {
    try {
      validateListNotificationsQuery({ page: '1', limit: 10 });
      expect.fail('expected ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).messageKey).toBe(LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY);
    }
  });
});
