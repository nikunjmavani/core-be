import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@/shared/constants/index.js';
import { PutNotificationPreferencesDto } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.dto.js';

/**
 * `PUT /users/me/notification-preferences` has replace-all semantics: the service deletes the
 * caller's rows and re-inserts exactly this list. That makes the array bound the write amplifier —
 * one request produces up to 200 inserts — and makes the empty-array case meaningful rather than a
 * no-op, since it clears every stored preference.
 *
 * The per-entry `.strict()` is the more subtle guard. Each entry is keyed by
 * `(notification_type, channel, organization_id?)`, so an unrecognised key on an entry is a caller
 * describing a binding the server does not model. Rejecting it here keeps the reconcile step from
 * silently writing a row that means something different from what was asked for.
 */
describe('user-notification-preferences.dto', () => {
  const entry = {
    notification_type: 'security.alert',
    channel: 'EMAIL',
    is_enabled: true,
  } as const;

  describe('replace-all semantics', () => {
    it('accepts an empty array — clears every stored preference', () => {
      expect(PutNotificationPreferencesDto.safeParse({ preferences: [] }).success).toBe(true);
    });

    it('requires the preferences field (an omitted body is not an empty set)', () => {
      expect(PutNotificationPreferencesDto.safeParse({}).success).toBe(false);
    });

    it('rejects null for preferences', () => {
      expect(PutNotificationPreferencesDto.safeParse({ preferences: null }).success).toBe(false);
    });

    it('accepts 200 entries', () => {
      const preferences = Array.from({ length: 200 }, () => ({ ...entry }));

      expect(PutNotificationPreferencesDto.safeParse({ preferences }).success).toBe(true);
    });

    it('rejects 201 entries', () => {
      // One request must not be able to drive an unbounded number of inserts.
      const preferences = Array.from({ length: 201 }, () => ({ ...entry }));

      expect(PutNotificationPreferencesDto.safeParse({ preferences }).success).toBe(false);
    });

    it('rejects the whole body when one entry is malformed', () => {
      const preferences = [{ ...entry }, { ...entry, channel: 'CARRIER_PIGEON' }, { ...entry }];

      expect(PutNotificationPreferencesDto.safeParse({ preferences }).success).toBe(false);
    });
  });

  describe('entry vocabulary', () => {
    it.each(NOTIFICATION_TYPES)('accepts notification_type %s', (notification_type) => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, notification_type }] })
          .success,
      ).toBe(true);
    });

    it.each(NOTIFICATION_CHANNELS)('accepts channel %s', (channel) => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, channel }] }).success,
      ).toBe(true);
    });

    it.each([
      ['an unknown type', 'security.made_up'],
      ['wrong case', 'SECURITY.ALERT'],
      ['an empty string', ''],
      ['null', null],
    ])('rejects notification_type %s', (_label, notification_type) => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, notification_type }] })
          .success,
      ).toBe(false);
    });

    it.each([
      ['an unknown channel', 'CARRIER_PIGEON'],
      ['wrong case', 'email'],
      ['an empty string', ''],
    ])('rejects channel %s', (_label, channel) => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, channel }] }).success,
      ).toBe(false);
    });

    it('requires is_enabled — there is no implicit default', () => {
      // A missing flag would have to be guessed at insert time; the caller states it explicitly.
      const { is_enabled: _omitted, ...withoutFlag } = entry;

      expect(PutNotificationPreferencesDto.safeParse({ preferences: [withoutFlag] }).success).toBe(
        false,
      );
    });

    it.each([
      ['the string "true"', 'true'],
      ['the number 1', 1],
      ['null', null],
    ])('rejects is_enabled as %s (no coercion)', (_label, is_enabled) => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, is_enabled }] })
          .success,
      ).toBe(false);
    });

    it.each([
      ['an unknown key', { scope: 'global' }],
      ['a user id', { user_id: 'usr_other' }],
      ['an id', { id: 42 }],
    ])('rejects an entry carrying %s (.strict per entry)', (_label, extra) => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, ...extra }] }).success,
      ).toBe(false);
    });

    it('rejects an unknown key at the body level (.strict)', () => {
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [], user_id: 'usr_other' }).success,
      ).toBe(false);
    });
  });

  describe('organization_id scoping', () => {
    it('accepts an omitted organization_id (an account-wide preference)', () => {
      expect(PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry }] }).success).toBe(
        true,
      );
    });

    it('accepts null for an explicitly account-wide preference', () => {
      expect(
        PutNotificationPreferencesDto.safeParse({
          preferences: [{ ...entry, organization_id: null }],
        }).success,
      ).toBe(true);
    });

    it('accepts a numeric organization_id at the schema layer', () => {
      // The field is the internal numeric id, and the schema does NOT check membership — the
      // service scopes the write to the caller's own organizations. Pinned so a reader does not
      // mistake schema acceptance for authorization.
      expect(
        PutNotificationPreferencesDto.safeParse({ preferences: [{ ...entry, organization_id: 7 }] })
          .success,
      ).toBe(true);
    });

    it('rejects a string organization_id (no coercion)', () => {
      expect(
        PutNotificationPreferencesDto.safeParse({
          preferences: [{ ...entry, organization_id: 'org_abcdefghijklmnopqrst' }],
        }).success,
      ).toBe(false);
    });
  });
});
