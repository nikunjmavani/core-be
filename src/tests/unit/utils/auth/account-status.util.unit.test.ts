import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { assertUserAccountActive } from '@/shared/utils/auth/account-status.util.js';

describe('assertUserAccountActive', () => {
  it('allows an ACTIVE account', () => {
    expect(() => assertUserAccountActive('ACTIVE')).not.toThrow();
  });

  it.each([
    'SUSPENDED',
    'LOCKED',
    'DELETED',
    '',
  ])('rejects non-active status %s with UnauthorizedError', (status) => {
    expect(() => assertUserAccountActive(status)).toThrow(UnauthorizedError);
  });

  it('throws the accountNotActive i18n key', () => {
    try {
      assertUserAccountActive('SUSPENDED');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect((error as UnauthorizedError).messageKey).toBe('errors:accountNotActive');
    }
  });
});
