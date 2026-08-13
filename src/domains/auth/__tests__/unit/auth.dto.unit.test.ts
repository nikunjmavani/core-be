import { describe, expect, it } from 'vitest';
import {
  authMethodPublicIdParamsDto,
  EmailLoginDto,
  MfaEnrollConfirmDto,
  MfaEnrollDto,
  MfaLoginVerifyDto,
  MfaVerifyDto,
  mfaMethodIdParamsDto,
  OauthCallbackQueryDto,
  oauthProviderParamsDto,
  passwordPolicy,
  ResetPasswordDto,
  StepUpVerifyDto,
} from '@/domains/auth/auth.dto.js';

/**
 * The auth schemas that the existing `auth.validator` suite does not reach: the password strength
 * policy on its own terms, the step-up union, the MFA-login one-of rule, and the public-id param
 * regexes.
 *
 * Three of these are load-bearing in a way the shape does not advertise:
 *
 * - `passwordPolicy()` is shared by reset AND change so the rule cannot drift between them. It is
 *   deliberately NOT applied to login / step-up / `current_password`, which verify an EXISTING
 *   credential — applying it there would lock out every user whose password predates the policy.
 * - `StepUpVerifyDto` is a union of two `.strict()` members, which makes "exactly one factor" a
 *   structural property: a body carrying both `password` and `code` fails both members.
 * - `mfaMethodIdParamsDto` / `authMethodPublicIdParamsDto` pin the `am_` public-id form (route-#10).
 *   Loosening either back to a bare string would re-expose the sequential DB id these replaced.
 */
describe('auth.dto', () => {
  describe('passwordPolicy', () => {
    const policy = passwordPolicy();

    it.each([
      ['lowercase + uppercase + digit', 'Password1234'],
      ['lowercase + digit + symbol', 'password!234'],
      ['uppercase + digit + symbol', 'PASSWORD!234'],
      ['all four classes', 'Password!234'],
    ])('accepts %s (3 of 4 classes)', (_label, password) => {
      expect(policy.safeParse(password).success).toBe(true);
    });

    it.each([
      ['lowercase only', 'passwordpassword'],
      ['lowercase + uppercase', 'PasswordPassword'],
      ['lowercase + digit', 'password123456'],
      ['digits only', '123456789012'],
      ['uppercase + digit', 'PASSWORD123456'],
    ])('rejects %s (only 2 classes)', (_label, password) => {
      expect(policy.safeParse(password).success).toBe(false);
    });

    it('accepts exactly 12 characters', () => {
      expect(policy.safeParse('Passw0rd!abc').success).toBe(true);
    });

    it('rejects 11 characters even with all four classes', () => {
      expect(policy.safeParse('Passw0rd!ab').success).toBe(false);
    });

    it('accepts 128 characters', () => {
      expect(policy.safeParse(`Aa1${'b'.repeat(125)}`).success).toBe(true);
    });

    it('rejects 129 characters', () => {
      expect(policy.safeParse(`Aa1${'b'.repeat(126)}`).success).toBe(false);
    });

    it('measures length AFTER trimming', () => {
      // Padding a short password with spaces must not buy it length.
      expect(policy.safeParse('   Aa1bcde   ').success).toBe(false);
    });

    it('does not count uppercase twice as a symbol', () => {
      // The symbol class is /[^a-z\d]/i — case-insensitive, so letters are excluded from it.
      // If it were case-sensitive, "PasswordAbcd" would score 3 classes and wrongly pass.
      expect(policy.safeParse('PasswordAbcd').success).toBe(false);
    });

    it.each([
      ['a space as the symbol class', 'Pass word123'],
      ['a unicode symbol', 'Password123€'],
      ['an emoji', 'Password123🔐'],
    ])('counts %s toward the class requirement', (_label, password) => {
      expect(policy.safeParse(password).success).toBe(true);
    });

    it('is the same rule reset uses', () => {
      const weak = { token: 'a'.repeat(32), password: 'password1234' };

      expect(ResetPasswordDto.safeParse(weak).success).toBe(false);
    });

    it('rejects a reset token over 512 characters', () => {
      expect(
        ResetPasswordDto.safeParse({ token: 'a'.repeat(513), password: 'Password!234' }).success,
      ).toBe(false);
    });

    it('rejects an empty reset token', () => {
      expect(ResetPasswordDto.safeParse({ token: '', password: 'Password!234' }).success).toBe(
        false,
      );
    });

    it('rejects extra keys on reset (.strict)', () => {
      expect(
        ResetPasswordDto.safeParse({
          token: 'a'.repeat(32),
          password: 'Password!234',
          user_id: 'usr_other',
        }).success,
      ).toBe(false);
    });
  });

  describe('StepUpVerifyDto — exactly one factor', () => {
    it('accepts a password-only body', () => {
      expect(StepUpVerifyDto.safeParse({ password: 'anything' }).success).toBe(true);
    });

    it('accepts a code-only body', () => {
      expect(StepUpVerifyDto.safeParse({ code: 'A1B2C3' }).success).toBe(true);
    });

    it('rejects a body carrying BOTH factors', () => {
      // Each union member is .strict(), so the extra key fails whichever member would match.
      expect(StepUpVerifyDto.safeParse({ password: 'anything', code: 'A1B2C3' }).success).toBe(
        false,
      );
    });

    it('rejects an empty body', () => {
      expect(StepUpVerifyDto.safeParse({}).success).toBe(false);
    });

    it('does NOT apply the strength policy to the step-up password', () => {
      // Step-up verifies an existing credential; enforcing the new-password policy here would
      // lock out every account whose password predates the policy.
      expect(StepUpVerifyDto.safeParse({ password: 'old' }).success).toBe(true);
    });

    it('still rejects an empty password', () => {
      expect(StepUpVerifyDto.safeParse({ password: '' }).success).toBe(false);
    });

    it.each([
      ['5 characters', 'A1B2C'],
      ['7 characters', 'A1B2C3D'],
      ['a symbol', 'A1B2C!'],
      ['a space', 'A1B2C '],
    ])('rejects a code with %s', (_label, code) => {
      expect(StepUpVerifyDto.safeParse({ code }).success).toBe(false);
    });
  });

  describe('EmailLoginDto', () => {
    const email = 'person@example.com';

    it.each([
      ['uppercase', 'A1B2C3'],
      ['lowercase', 'a1b2c3'],
      ['mixed case', 'aB3dE6'],
      ['all digits', '123456'],
      ['all letters', 'abcdef'],
    ])('accepts a %s code (case-insensitive by design)', (_label, code) => {
      expect(EmailLoginDto.safeParse({ email, code }).success).toBe(true);
    });

    it.each([
      ['a hyphen', 'A1B-C3'],
      ['a 5-char code', 'A1B2C'],
      ['a 7-char code', 'A1B2C3D'],
      ['an empty code', ''],
      ['a unicode digit', '１２３４５６'],
    ])('rejects %s', (_label, code) => {
      expect(EmailLoginDto.safeParse({ email, code }).success).toBe(false);
    });

    it('lowercases the email for canonical matching', () => {
      expect(EmailLoginDto.parse({ email: 'Person@Example.COM', code: 'A1B2C3' }).email).toBe(
        email,
      );
    });

    it('rejects Gmail plus addressing', () => {
      expect(EmailLoginDto.safeParse({ email: 'a+b@gmail.com', code: 'A1B2C3' }).success).toBe(
        false,
      );
    });
  });

  describe('TOTP code schemas', () => {
    it.each([
      ['MfaVerifyDto', MfaVerifyDto],
      ['MfaEnrollConfirmDto', MfaEnrollConfirmDto],
    ] as const)('%s accepts 6 digits', (_name, schema) => {
      expect(schema.safeParse({ code: '012345' }).success).toBe(true);
    });

    it.each([
      ['MfaVerifyDto', MfaVerifyDto],
      ['MfaEnrollConfirmDto', MfaEnrollConfirmDto],
    ] as const)('%s rejects letters (TOTP is digits only)', (_name, schema) => {
      expect(schema.safeParse({ code: 'A1B2C3' }).success).toBe(false);
    });

    it.each([
      ['MfaVerifyDto', MfaVerifyDto],
      ['MfaEnrollConfirmDto', MfaEnrollConfirmDto],
    ] as const)('%s rejects wrong lengths and non-strings', (_name, schema) => {
      expect(schema.safeParse({ code: '12345' }).success).toBe(false);
      expect(schema.safeParse({ code: '1234567' }).success).toBe(false);
      expect(schema.safeParse({ code: 123456 }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    });

    it('MfaEnrollDto accepts only MFA_TOTP', () => {
      expect(MfaEnrollDto.safeParse({ method_type: 'MFA_TOTP' }).success).toBe(true);
    });

    it.each([['MFA_SMS'], ['PASSWORD'], ['mfa_totp'], ['EMAIL_CODE']])(
      'MfaEnrollDto rejects method_type %s',
      (method_type) => {
        expect(MfaEnrollDto.safeParse({ method_type }).success).toBe(false);
      },
    );
  });

  describe('MfaLoginVerifyDto — one-of totp_code / recovery_code', () => {
    const mfa_session_token = 'a'.repeat(40);

    it('accepts a TOTP code', () => {
      expect(MfaLoginVerifyDto.safeParse({ mfa_session_token, totp_code: '123456' }).success).toBe(
        true,
      );
    });

    it('accepts a recovery code', () => {
      expect(
        MfaLoginVerifyDto.safeParse({ mfa_session_token, recovery_code: 'abcd-efgh' }).success,
      ).toBe(true);
    });

    it('rejects a body with neither factor', () => {
      expect(MfaLoginVerifyDto.safeParse({ mfa_session_token }).success).toBe(false);
    });

    it('reports the missing factor on the totp_code path', () => {
      const result = MfaLoginVerifyDto.safeParse({ mfa_session_token });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(['totp_code']);
      }
    });

    it('permits BOTH factors — the refine is an OR, not an XOR', () => {
      // Pinned as documented behaviour: the service decides precedence. If this ever needs to be
      // exclusive, the schema is the place to change, and this test is the one that will notice.
      expect(
        MfaLoginVerifyDto.safeParse({
          mfa_session_token,
          totp_code: '123456',
          recovery_code: 'abcd-efgh',
        }).success,
      ).toBe(true);
    });

    it('requires the mfa_session_token', () => {
      expect(MfaLoginVerifyDto.safeParse({ totp_code: '123456' }).success).toBe(false);
    });

    it('rejects an mfa_session_token over 128 characters', () => {
      expect(
        MfaLoginVerifyDto.safeParse({ mfa_session_token: 'a'.repeat(129), totp_code: '123456' })
          .success,
      ).toBe(false);
    });

    it.each([
      ['a 7-character recovery code', 'abcdefg'],
      ['a 65-character recovery code', 'a'.repeat(65)],
    ])('rejects %s', (_label, recovery_code) => {
      expect(MfaLoginVerifyDto.safeParse({ mfa_session_token, recovery_code }).success).toBe(false);
    });

    it('rejects an unknown key alongside a valid factor (.strict)', () => {
      expect(
        MfaLoginVerifyDto.safeParse({ mfa_session_token, totp_code: '123456', user_id: 'usr_x' })
          .success,
      ).toBe(false);
    });
  });

  describe('public-id path params (route-#10)', () => {
    const schemas = [
      ['mfaMethodIdParamsDto', mfaMethodIdParamsDto, 'mfa_method_id'],
      ['authMethodPublicIdParamsDto', authMethodPublicIdParamsDto, 'auth_method_id'],
    ] as const;
    const valid = `am_${'a'.repeat(21)}`;

    it.each(schemas)('%s accepts a canonical am_ public id', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: valid }).success).toBe(true);
    });

    it.each(schemas)('%s rejects a sequential database id', (_name, schema, field) => {
      // The whole point of the change: a numeric row id must not be addressable.
      expect(schema.safeParse({ [field]: '42' }).success).toBe(false);
    });

    it.each(schemas)('%s rejects the wrong entity prefix', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: `usr_${'a'.repeat(21)}` }).success).toBe(false);
    });

    it.each(schemas)('%s rejects a wrong-length suffix', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: `am_${'a'.repeat(20)}` }).success).toBe(false);
      expect(schema.safeParse({ [field]: `am_${'a'.repeat(22)}` }).success).toBe(false);
    });

    it.each(schemas)('%s rejects uppercase in the suffix', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: `am_${'A'.repeat(21)}` }).success).toBe(false);
    });

    it.each(schemas)('%s rejects a trailing path segment', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: `${valid}/../other` }).success).toBe(false);
    });

    it.each(schemas)('%s rejects an extra param', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: valid, user_id: 'usr_other' }).success).toBe(false);
    });
  });

  describe('OAuth schemas', () => {
    it('accepts a well-formed callback query', () => {
      expect(OauthCallbackQueryDto.safeParse({ code: 'abc', state: 'xyz' }).success).toBe(true);
    });

    it.each([
      ['a missing state', { code: 'abc' }],
      ['a missing code', { state: 'xyz' }],
      ['an empty code', { code: '', state: 'xyz' }],
      ['an empty state', { code: 'abc', state: '' }],
      ['a code over 2048 characters', { code: 'a'.repeat(2049), state: 'xyz' }],
      ['a state over 512 characters', { code: 'abc', state: 'a'.repeat(513) }],
    ])('rejects %s', (_label, input) => {
      expect(OauthCallbackQueryDto.safeParse(input).success).toBe(false);
    });

    it('rejects an unexpected query parameter', () => {
      // A provider error arrives on its own route shape; smuggling extra keys through the happy
      // path is not accepted.
      expect(
        OauthCallbackQueryDto.safeParse({ code: 'abc', state: 'xyz', error: 'access_denied' })
          .success,
      ).toBe(false);
    });

    it('accepts a provider slug', () => {
      expect(oauthProviderParamsDto.safeParse({ provider: 'google' }).success).toBe(true);
    });

    it.each([
      ['an empty provider', { provider: '' }],
      ['a provider over 50 characters', { provider: 'a'.repeat(51) }],
      ['an extra param', { provider: 'google', redirect_uri: 'https://evil.example.com' }],
    ])('rejects %s', (_label, input) => {
      expect(oauthProviderParamsDto.safeParse(input).success).toBe(false);
    });
  });
});
