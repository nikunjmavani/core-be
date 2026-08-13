import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@/shared/constants/index.js';
import {
  createOrganizationNotificationPolicyDto,
  notificationPolicyIdParamsDto,
  updateOrganizationNotificationPolicyDto,
} from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.dto.js';

/**
 * An organization notification policy binds a `(notification_type, channel)` pair to delivery
 * flags. The pair is the row's identity, which is why the update schema deliberately omits both
 * fields: repointing an existing policy at a different type or channel would silently redirect
 * delivery for an established binding rather than create a new one, and `is_mandatory` means some
 * of those bindings are ones members cannot opt out of.
 *
 * `.strict()` is what enforces that immutability — the fields are not "ignored if sent", they are
 * rejected. Widening the update schema to accept them would be a contract change that no other
 * test in the repo would notice.
 */
describe('organization-notification-policy.dto', () => {
  const valid = { notification_type: 'security.alert', channel: 'EMAIL' } as const;

  describe('create', () => {
    it.each(NOTIFICATION_TYPES)('accepts notification_type %s', (notification_type) => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, notification_type }).success,
      ).toBe(true);
    });

    it.each(NOTIFICATION_CHANNELS)('accepts channel %s', (channel) => {
      expect(createOrganizationNotificationPolicyDto.safeParse({ ...valid, channel }).success).toBe(
        true,
      );
    });

    it.each([
      ['an unknown type', 'security.made_up'],
      ['wrong case', 'SECURITY.ALERT'],
      ['an empty string', ''],
    ])('rejects notification_type %s', (_label, notification_type) => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, notification_type }).success,
      ).toBe(false);
    });

    it.each([
      ['an unknown channel', 'CARRIER_PIGEON'],
      ['wrong case', 'email'],
      ['an empty string', ''],
    ])('rejects channel %s', (_label, channel) => {
      expect(createOrganizationNotificationPolicyDto.safeParse({ ...valid, channel }).success).toBe(
        false,
      );
    });

    it('requires both halves of the binding', () => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ notification_type: 'security.alert' })
          .success,
      ).toBe(false);
      expect(createOrganizationNotificationPolicyDto.safeParse({ channel: 'EMAIL' }).success).toBe(
        false,
      );
    });

    it('defaults default_enabled to true', () => {
      expect(createOrganizationNotificationPolicyDto.parse(valid).default_enabled).toBe(true);
    });

    it('defaults is_mandatory to false', () => {
      // The safe default: a policy members can opt out of unless explicitly made mandatory.
      expect(createOrganizationNotificationPolicyDto.parse(valid).is_mandatory).toBe(false);
    });

    it.each([
      ['the string "true"', 'true'],
      ['the number 1', 1],
      ['null', null],
    ])('rejects is_mandatory as %s (no coercion into a non-optional policy)', (_label, value) => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, is_mandatory: value })
          .success,
      ).toBe(false);
    });

    it.each([
      ['an organization id', { organization_id: 'org_other' }],
      ['an id', { id: 'nps_abcdefghijklmnopqrst' }],
      ['a created_at', { created_at: '2020-01-01T00:00:00.000Z' }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, ...extra }).success,
      ).toBe(false);
    });
  });

  describe('muted_until', () => {
    it('accepts an ISO 8601 datetime', () => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({
          ...valid,
          muted_until: '2030-01-01T00:00:00.000Z',
        }).success,
      ).toBe(true);
    });

    it('accepts null to clear the mute window', () => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, muted_until: null }).success,
      ).toBe(true);
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({
          ...valid,
          muted_until: '  2030-01-01T00:00:00.000Z  ',
        }).success,
      ).toBe(true);
    });

    it.each([
      ['a date without a time', '2030-01-01'],
      ['a unix timestamp', '1893456000'],
      ['free text', 'tomorrow'],
      ['an empty string', ''],
      ['an invalid calendar date', '2030-13-45T00:00:00.000Z'],
    ])('rejects %s', (_label, muted_until) => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, muted_until }).success,
      ).toBe(false);
    });

    it('rejects a numeric timestamp (no coercion)', () => {
      expect(
        createOrganizationNotificationPolicyDto.safeParse({ ...valid, muted_until: 1893456000 })
          .success,
      ).toBe(false);
    });
  });

  describe('update — type and channel are immutable', () => {
    it('rejects a notification_type change', () => {
      expect(
        updateOrganizationNotificationPolicyDto.safeParse({ notification_type: 'system.welcome' })
          .success,
      ).toBe(false);
    });

    it('rejects a channel change', () => {
      expect(updateOrganizationNotificationPolicyDto.safeParse({ channel: 'SMS' }).success).toBe(
        false,
      );
    });

    it('rejects a valid flag change smuggled alongside a channel change', () => {
      // The rejection is all-or-nothing: the immutable field is not quietly dropped while the rest
      // of the patch applies.
      expect(
        updateOrganizationNotificationPolicyDto.safeParse({
          default_enabled: false,
          channel: 'SMS',
        }).success,
      ).toBe(false);
    });

    it.each([
      ['default_enabled', { default_enabled: false }],
      ['is_mandatory', { is_mandatory: true }],
      ['muted_until', { muted_until: '2030-01-01T00:00:00.000Z' }],
      ['muted_until cleared', { muted_until: null }],
    ])('accepts a %s patch', (_label, patch) => {
      expect(updateOrganizationNotificationPolicyDto.safeParse(patch).success).toBe(true);
    });

    it('accepts an empty patch', () => {
      expect(updateOrganizationNotificationPolicyDto.safeParse({}).success).toBe(true);
    });

    it('applies no defaults on update (an omitted flag stays as stored)', () => {
      // Unlike create, a default here would silently rewrite a flag the caller never mentioned.
      const result = updateOrganizationNotificationPolicyDto.parse({});

      expect(result).not.toHaveProperty('default_enabled');
      expect(result).not.toHaveProperty('is_mandatory');
    });
  });

  describe('notificationPolicyIdParamsDto', () => {
    it('accepts a well-formed id', () => {
      expect(
        notificationPolicyIdParamsDto.safeParse({
          notification_policy_id: 'nps_abcdefghijklmnopqrst',
        }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty id', { notification_policy_id: '' }],
      ['an id over 28 characters', { notification_policy_id: 'n'.repeat(29) }],
      ['a missing id', {}],
      ['a numeric id', { notification_policy_id: 42 }],
      ['an extra param', { notification_policy_id: 'nps_abc', organization_id: 'org_other' }],
    ])('rejects %s', (_label, input) => {
      expect(notificationPolicyIdParamsDto.safeParse(input).success).toBe(false);
    });
  });
});
