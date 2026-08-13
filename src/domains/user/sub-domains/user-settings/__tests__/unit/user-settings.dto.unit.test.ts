import { describe, expect, it } from 'vitest';
import { UpdateUserSettingsDto } from '@/domains/user/sub-domains/user-settings/user-settings.dto.js';

/**
 * `PATCH /users/me/settings` is an upsert-merge: omitted fields keep their stored value, so every
 * field must be independently optional and none may carry a default — a default here would rewrite
 * a toggle the caller never mentioned on any partial update.
 *
 * `preferred_locales` is the field with teeth: it is a caller-supplied array that feeds locale
 * negotiation, so it is bounded on both axes (at most 10 entries, each at most 10 characters).
 * Unlike `default_locale` on the organization settings schema, it is NOT enum-constrained — the
 * list is an ordered preference, and an unsupported tag falls through to the default locale rather
 * than being rejected. That asymmetry is intentional and is pinned below.
 */
describe('user-settings.dto', () => {
  describe('PATCH merge semantics', () => {
    it('accepts an empty body', () => {
      expect(UpdateUserSettingsDto.safeParse({}).success).toBe(true);
    });

    it('applies no defaults, so an omitted toggle stays as stored', () => {
      const result = UpdateUserSettingsDto.parse({});

      expect(result).toEqual({});
    });

    it.each([
      ['is_dark_mode_enabled', { is_dark_mode_enabled: true }],
      ['is_notifications_enabled', { is_notifications_enabled: false }],
      ['language', { language: 'en' }],
      ['preferred_locales', { preferred_locales: ['en', 'es'] }],
    ])('accepts a %s-only patch', (_label, patch) => {
      expect(UpdateUserSettingsDto.safeParse(patch).success).toBe(true);
    });
  });

  describe('boolean toggles', () => {
    it.each([
      ['the string "true"', 'true'],
      ['the string "false"', 'false'],
      ['the number 1', 1],
      ['the number 0', 0],
      ['null', null],
    ])('rejects is_dark_mode_enabled as %s (no coercion)', (_label, value) => {
      expect(UpdateUserSettingsDto.safeParse({ is_dark_mode_enabled: value }).success).toBe(false);
    });

    it('rejects null for is_notifications_enabled', () => {
      // Null is not "unset" on a PATCH — omitting the field is.
      expect(UpdateUserSettingsDto.safeParse({ is_notifications_enabled: null }).success).toBe(
        false,
      );
    });
  });

  describe('language', () => {
    it('accepts a short tag', () => {
      expect(UpdateUserSettingsDto.safeParse({ language: 'en' }).success).toBe(true);
    });

    it('accepts a tag at 10 characters', () => {
      expect(UpdateUserSettingsDto.safeParse({ language: 'a'.repeat(10) }).success).toBe(true);
    });

    it('rejects a tag over 10 characters', () => {
      expect(UpdateUserSettingsDto.safeParse({ language: 'a'.repeat(11) }).success).toBe(false);
    });

    it('trims surrounding whitespace', () => {
      expect(UpdateUserSettingsDto.parse({ language: '  en  ' }).language).toBe('en');
    });

    it('measures length AFTER trimming', () => {
      expect(UpdateUserSettingsDto.safeParse({ language: `  ${'a'.repeat(10)}  ` }).success).toBe(
        true,
      );
    });

    it.each([
      ['a number', 42],
      ['null', null],
      ['an array', ['en']],
    ])('rejects %s', (_label, language) => {
      expect(UpdateUserSettingsDto.safeParse({ language }).success).toBe(false);
    });
  });

  describe('preferred_locales', () => {
    it('accepts an empty array', () => {
      expect(UpdateUserSettingsDto.safeParse({ preferred_locales: [] }).success).toBe(true);
    });

    it('accepts 10 entries', () => {
      const preferred_locales = Array.from({ length: 10 }, () => 'en');

      expect(UpdateUserSettingsDto.safeParse({ preferred_locales }).success).toBe(true);
    });

    it('rejects 11 entries', () => {
      const preferred_locales = Array.from({ length: 11 }, () => 'en');

      expect(UpdateUserSettingsDto.safeParse({ preferred_locales }).success).toBe(false);
    });

    it('rejects an entry over 10 characters', () => {
      expect(UpdateUserSettingsDto.safeParse({ preferred_locales: ['a'.repeat(11)] }).success).toBe(
        false,
      );
    });

    it('rejects the whole array when one entry is malformed', () => {
      expect(
        UpdateUserSettingsDto.safeParse({ preferred_locales: ['en', 'a'.repeat(11), 'es'] })
          .success,
      ).toBe(false);
    });

    it('accepts an unsupported locale tag — negotiation falls back, it does not reject', () => {
      // Deliberately unlike organization settings' enum-constrained `default_locale`: this is an
      // ordered preference list, so an unknown tag is skipped at negotiation time.
      expect(UpdateUserSettingsDto.safeParse({ preferred_locales: ['zz'] }).success).toBe(true);
    });

    it('trims each entry', () => {
      expect(
        UpdateUserSettingsDto.parse({ preferred_locales: ['  en  '] }).preferred_locales,
      ).toEqual(['en']);
    });

    it.each([
      ['a string instead of an array', 'en'],
      ['null', null],
      ['an array of numbers', [1, 2]],
      ['a nested array', [['en']]],
    ])('rejects %s', (_label, preferred_locales) => {
      expect(UpdateUserSettingsDto.safeParse({ preferred_locales }).success).toBe(false);
    });
  });

  describe('mass-assignment boundary', () => {
    it.each([
      ['a user id', { user_id: 'usr_other' }],
      ['a role', { role: 'super_admin' }],
      ['an email', { email: 'new@example.com' }],
      ['an is_mfa_enabled flag', { is_mfa_enabled: false }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      // Settings is not a back door into identity, credentials or authorization state.
      expect(UpdateUserSettingsDto.safeParse(extra).success).toBe(false);
    });
  });
});
