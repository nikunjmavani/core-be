import { describe, expect, it } from 'vitest';
import { validateDataExportIdParam } from '@/domains/user/sub-domains/user-data-export/user-data-export.validator.js';
import { ValidationError } from '@/shared/errors/index.js';

/**
 * Path-param validator for `GET /users/me/data-export/:data_export_id`.
 *
 * @remarks
 * A data export is a downloadable archive of a user's personal data, so the id on this route
 * selects which archive is served. The validator is the first thing between an arbitrary URL
 * segment and that lookup — it must reject anything that is not a plausible public id, and it must
 * fail as a 400-class `ValidationError` with a field-level issue rather than letting a malformed
 * value reach the repository.
 */
const VALID_ID = 'exp_abcdefghijklmnopqrstu';

describe('validateDataExportIdParam', () => {
  it('accepts and returns a well-formed id', () => {
    expect(validateDataExportIdParam({ data_export_id: VALID_ID })).toEqual({
      data_export_id: VALID_ID,
    });
  });

  it('returns the parsed object, not the raw input', () => {
    // The route uses the returned value; handing back the raw input would carry any extra keys
    // straight through to the service.
    const result = validateDataExportIdParam({ data_export_id: VALID_ID, extra: 'ignored' });

    expect(result.data_export_id).toBe(VALID_ID);
  });

  it.each([
    ['a missing param', {}],
    ['an empty string', { data_export_id: '' }],
    ['null', { data_export_id: null }],
    ['undefined', { data_export_id: undefined }],
    ['a number', { data_export_id: 42 }],
    ['an array', { data_export_id: [VALID_ID] }],
    ['an object', { data_export_id: { id: VALID_ID } }],
  ])('rejects %s with a ValidationError', (_label, input) => {
    expect(() => validateDataExportIdParam(input)).toThrow(ValidationError);
  });

  it('rejects an over-long id', () => {
    // Bounded length keeps an absurd URL segment from reaching a database query at all.
    expect(() => validateDataExportIdParam({ data_export_id: 'x'.repeat(512) })).toThrow(
      ValidationError,
    );
  });

  it.each([
    ['null input', null],
    ['undefined input', undefined],
    ['a string', 'exp_abc'],
    ['an array', []],
  ])('rejects %s rather than throwing a raw TypeError', (_label, input) => {
    // The validator receives `request.params`, which is normally an object — but a throw of the
    // wrong type here would surface as a 500 instead of a 400.
    expect(() => validateDataExportIdParam(input)).toThrow(ValidationError);
  });

  it('reports the offending field so the client can act on it', () => {
    try {
      validateDataExportIdParam({});
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const issues = (error as ValidationError).errors ?? [];
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.field).toBe('data_export_id');
    }
  });

  it('uses the snake_case field name the API contract requires', () => {
    // Validation `errors[].field` values are snake_case per the API contract; a camelCase leak
    // here would not match the request body the client sent.
    try {
      validateDataExportIdParam({ data_export_id: '' });
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      const field = (error as ValidationError).errors?.[0]?.field ?? '';
      expect(field).not.toMatch(/[A-Z]/);
    }
  });

  it('carries the invalidInput message key', () => {
    try {
      validateDataExportIdParam({});
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect((error as ValidationError).messageKey).toBe('errors:invalidInput');
    }
  });
});
