import { describe, expect, it } from 'vitest';
import {
  deleteNotificationParamsDto,
  getNotificationParamsDto,
  listNotificationsQueryDto,
} from '@/domains/notify/sub-domains/notification/notification.dto.js';

/**
 * The notification inbox schemas. The interesting one is `include_total`: it defaults to `'false'`
 * so the inbox listing stays keyset-only, because a `count(*)` over a user's notifications is the
 * kind of query that is free on a demo account and expensive on a busy one. Losing the default —
 * or widening the enum to accept an arbitrary truthy string — silently turns every inbox page
 * into a full count.
 */
describe('notification.dto', () => {
  describe('listNotificationsQueryDto', () => {
    it('defaults include_total to the string "false"', () => {
      // A string, not a boolean: it arrives as a query parameter.
      expect(listNotificationsQueryDto.parse({}).include_total).toBe('false');
    });

    it.each(['true', 'false'])('accepts include_total="%s"', (include_total) => {
      expect(listNotificationsQueryDto.safeParse({ include_total }).success).toBe(true);
    });

    it.each([
      ['a boolean true', true],
      ['a boolean false', false],
      ['the number 1', 1],
      ['an empty string', ''],
      ['TRUE (wrong case)', 'TRUE'],
      ['yes', 'yes'],
      ['null', null],
    ])('rejects include_total as %s', (_label, include_total) => {
      expect(listNotificationsQueryDto.safeParse({ include_total }).success).toBe(false);
    });

    it('rejects an unknown query parameter', () => {
      // .strict() on a list query stops a caller probing for undocumented filters.
      expect(listNotificationsQueryDto.safeParse({ organization_id: 'org_other' }).success).toBe(
        false,
      );
    });

    it('accepts the inherited cursor-pagination parameters', () => {
      const result = listNotificationsQueryDto.safeParse({ limit: 20 });

      expect(result.success).toBe(true);
    });

    it('rejects a non-numeric limit', () => {
      expect(listNotificationsQueryDto.safeParse({ limit: 'all' }).success).toBe(false);
    });
  });

  describe('notification id param schemas', () => {
    const cases = [
      ['getNotificationParamsDto', getNotificationParamsDto],
      ['deleteNotificationParamsDto', deleteNotificationParamsDto],
    ] as const;

    it.each(cases)('%s accepts a well-formed id', (_name, schema) => {
      expect(schema.safeParse({ notification_id: 'ntf_abcdefghijklmnopqrst' }).success).toBe(true);
    });

    it.each(cases)('%s rejects an empty id', (_name, schema) => {
      expect(schema.safeParse({ notification_id: '' }).success).toBe(false);
    });

    it.each(cases)('%s rejects an id over 28 characters', (_name, schema) => {
      expect(schema.safeParse({ notification_id: 'n'.repeat(29) }).success).toBe(false);
    });

    it.each(cases)('%s rejects a missing id', (_name, schema) => {
      expect(schema.safeParse({}).success).toBe(false);
    });

    it.each(cases)('%s rejects an unknown extra param', (_name, schema) => {
      expect(schema.safeParse({ notification_id: 'ntf_abc', user_id: 'usr_other' }).success).toBe(
        false,
      );
    });

    it.each(cases)('%s rejects a numeric id', (_name, schema) => {
      expect(schema.safeParse({ notification_id: 42 }).success).toBe(false);
    });
  });
});
