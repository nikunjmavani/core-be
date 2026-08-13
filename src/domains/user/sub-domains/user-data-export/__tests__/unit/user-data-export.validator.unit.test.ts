import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateDataExportIdParam } from '@/domains/user/sub-domains/user-data-export/user-data-export.validator.js';

/**
 * Guards `GET /users/me/data-export/:data_export_id` — the route that hands back a bundle of the
 * caller's personal data. This validator hand-rolls its `ValidationError` (rather than going
 * through `parseWithSchema`), so its `errors[]` shape is its own code path and was untested. The
 * API contract requires `errors[].field` to be snake_case, which is exactly what the hand-rolled
 * `issue.path.join('.')` produces — and exactly what a refactor could silently change.
 */
describe('user-data-export.validator — validateDataExportIdParam', () => {
  it('accepts a well-formed export id', () => {
    expect(validateDataExportIdParam({ data_export_id: 'dex_abcdefghijklmnopqrstu' })).toEqual({
      data_export_id: 'dex_abcdefghijklmnopqrstu',
    });
  });

  it('accepts a single-character id (min boundary)', () => {
    expect(validateDataExportIdParam({ data_export_id: 'd' })).toEqual({ data_export_id: 'd' });
  });

  it('accepts a 28-character id (max boundary)', () => {
    const atMax = 'd'.repeat(28);

    expect(validateDataExportIdParam({ data_export_id: atMax })).toEqual({
      data_export_id: atMax,
    });
  });

  describe('rejections', () => {
    it.each([
      ['an empty id', { data_export_id: '' }],
      ['a 29-character id (over max)', { data_export_id: 'd'.repeat(29) }],
      ['a missing id', {}],
      ['a numeric id', { data_export_id: 42 }],
      ['a null id', { data_export_id: null }],
      ['an object id', { data_export_id: { toString: 'nope' } }],
      ['a null params object', null],
      ['an undefined params object', undefined],
    ])('throws ValidationError for %s', (_label, params) => {
      expect(() => validateDataExportIdParam(params)).toThrow(ValidationError);
    });

    it('raises a 400 carrying the invalid-input translation key', () => {
      try {
        validateDataExportIdParam({});
        expect.unreachable('validateDataExportIdParam should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toMatchObject({ statusCode: 400, messageKey: 'errors:invalidInput' });
      }
    });

    it('reports the field in snake_case, matching the API contract', () => {
      try {
        validateDataExportIdParam({});
        expect.unreachable('validateDataExportIdParam should have thrown');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.errors).toEqual([
          expect.objectContaining({ field: 'data_export_id' }),
        ]);
      }
    });

    it('attaches a human-readable message to each field entry', () => {
      try {
        validateDataExportIdParam({ data_export_id: '' });
        expect.unreachable('validateDataExportIdParam should have thrown');
      } catch (error) {
        const validationError = error as ValidationError;
        const entry = validationError.errors?.[0];
        expect(entry?.field).toBe('data_export_id');
        expect(typeof entry?.message).toBe('string');
        expect(entry?.message?.length).toBeGreaterThan(0);
      }
    });
  });
});
