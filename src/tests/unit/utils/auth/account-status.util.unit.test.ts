import { describe, expect, it } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '@/shared/errors/index.js';
import {
  assertEmailVerifiedForCredentialEnrollment,
  assertUserAccountActive,
} from '@/shared/utils/auth/account-status.util.js';

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

describe('assertEmailVerifiedForCredentialEnrollment', () => {
  it('allows an account whose email is verified', () => {
    expect(() =>
      assertEmailVerifiedForCredentialEnrollment({ is_email_verified: true }),
    ).not.toThrow();
  });

  it('rejects an unverified account with ForbiddenError (pre-hijacking guard)', () => {
    try {
      assertEmailVerifiedForCredentialEnrollment({ is_email_verified: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).messageKey).toBe(
        'errors:emailVerificationRequiredForCredential',
      );
    }
  });
});
