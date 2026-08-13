import { describe, expect, it } from 'vitest';
import {
  dataExportIdParamDto,
  exportUserDataBodyDto,
} from '@/domains/user/sub-domains/user-data-export/user-data-export.dto.js';

/**
 * The data-export schemas, one of which is empty on purpose.
 *
 * `exportUserDataBodyDto` is `z.object({}).strict()` because the export is scoped entirely by the
 * authenticated caller — the JWT decides whose data is packaged, and nothing in the body does. That
 * emptiness is the access-control boundary: a `user_id`, an `email`, or a `scope` accepted here
 * would be a request to export SOMEONE ELSE'S data, and `.strict()` is what turns each of those into
 * a 422 instead of a parameter the service might one day read.
 *
 * A GDPR export bundles a user's entire personal record, so this is the highest-value body in the
 * API to get wrong, and the emptiness is the sort of thing a future reader tidies up without
 * realising it is load-bearing.
 */
describe('user-data-export.dto', () => {
  describe('exportUserDataBodyDto — scoped by the token, never the body', () => {
    it('accepts an empty body', () => {
      expect(exportUserDataBodyDto.safeParse({}).success).toBe(true);
    });

    it.each([
      ['a user id', { user_id: 'usr_someone_else' }],
      ['a numeric user id', { user_id: 7 }],
      ['an email', { email: 'victim@example.com' }],
      ['an organization id', { organization_id: 'org_other' }],
      ['a scope widener', { scope: 'all' }],
      ['an include-all flag', { include_all_users: true }],
      ['a format override', { format: '../../etc/passwd' }],
    ])('rejects %s — that would be a request for another principal data', (_label, body) => {
      expect(exportUserDataBodyDto.safeParse(body).success).toBe(false);
    });

    it('rejects a non-object body', () => {
      expect(exportUserDataBodyDto.safeParse('all').success).toBe(false);
      expect(exportUserDataBodyDto.safeParse(null).success).toBe(false);
    });

    it('parses to an empty object, carrying nothing into the service', () => {
      expect(exportUserDataBodyDto.parse({})).toEqual({});
    });
  });

  describe('dataExportIdParamDto', () => {
    it('accepts a well-formed export id', () => {
      expect(
        dataExportIdParamDto.safeParse({ data_export_id: 'dex_abcdefghijklmnopqrst' }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty id', ''],
      ['an id over 28 characters', 'd'.repeat(29)],
    ])('rejects %s', (_label, data_export_id) => {
      expect(dataExportIdParamDto.safeParse({ data_export_id }).success).toBe(false);
    });

    it('accepts an id at exactly 28 characters', () => {
      expect(dataExportIdParamDto.safeParse({ data_export_id: 'd'.repeat(28) }).success).toBe(true);
    });

    it('rejects a missing id', () => {
      expect(dataExportIdParamDto.safeParse({}).success).toBe(false);
    });

    it.each([
      ['a number', 42],
      ['null', null],
    ])('rejects %s as an id', (_label, data_export_id) => {
      expect(dataExportIdParamDto.safeParse({ data_export_id }).success).toBe(false);
    });

    it('is NOT strict, so an unknown param is stripped rather than rejected', () => {
      // Pinned as observed behaviour, and it is safe here for one specific reason: the route
      // resolves the export by id AND owner, so a stray param cannot re-scope the lookup. Worth
      // knowing it differs from the strict param schemas elsewhere in the API.
      const result = dataExportIdParamDto.safeParse({
        data_export_id: 'dex_abcdefghijklmnopqrst',
        user_id: 'usr_other',
      });

      expect(result.success).toBe(true);
      expect(result.success && result.data).not.toHaveProperty('user_id');
    });
  });
});
