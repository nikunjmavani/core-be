import { describe, expect, it } from 'vitest';
import { validateDataExportIdParam } from '@/domains/user/sub-domains/user-data-export/user-data-export.validator.js';
import { ValidationError } from '@/shared/errors/index.js';

/**
 * The only validator in the user domain without a test. It guards the `:data_export_id` path param
 * on `GET /users/me/data-export/:data_export_id` — the single place a caller-supplied string
 * reaches the export lookup, so a malformed value must be rejected as a 422-shaped
 * {@link ValidationError} and never reach the repository.
 */
const VALID_EXPORT_ID = 'ude_aaaaaaaaaaaaaaaaaaaaa';

describe('validateDataExportIdParam', () => {
  it('accepts a well-formed data_export_id and returns the parsed param', () => {
    expect(validateDataExportIdParam({ data_export_id: VALID_EXPORT_ID })).toEqual({
      data_export_id: VALID_EXPORT_ID,
    });
  });

  it('throws ValidationError when the param is missing', () => {
    expect(() => validateDataExportIdParam({})).toThrow(ValidationError);
  });

  it('reports the offending field in snake_case so the error contract holds', () => {
    try {
      validateDataExportIdParam({});
      expect.unreachable('expected validateDataExportIdParam to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const { errors } = error as ValidationError & {
        errors?: Array<{ field: string; message: string }>;
      };
      expect(errors?.[0]?.field).toBe('data_export_id');
    }
  });

  it('rejects a non-string data_export_id', () => {
    expect(() => validateDataExportIdParam({ data_export_id: 12345 })).toThrow(ValidationError);
  });

  it('rejects an empty data_export_id', () => {
    expect(() => validateDataExportIdParam({ data_export_id: '' })).toThrow(ValidationError);
  });

  it('rejects an over-long id so an oversized param never reaches the lookup', () => {
    // The DTO caps at 28 chars — the public-id allowance. Anything longer is a probe, not a typo.
    expect(() => validateDataExportIdParam({ data_export_id: 'u'.repeat(29) })).toThrow(
      ValidationError,
    );
  });
});
