import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import {
  DEFAULT_INVALID_INPUT_ERROR_KEY,
  parseWithSchema,
} from '@/shared/utils/validation/parse-with-schema.util.js';

const schema = z.object({ name: z.string() });

describe('parse-with-schema.util', () => {
  describe('parseWithSchema', () => {
    it('returns the typed value when data matches the schema', () => {
      expect(parseWithSchema(schema, { name: 'acme' })).toEqual({ name: 'acme' });
    });

    it('throws a 400 ValidationError with the default key and flattened field errors', () => {
      try {
        parseWithSchema(schema, {});
        expect.fail('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.statusCode).toBe(400);
        expect(validationError.messageKey).toBe(DEFAULT_INVALID_INPUT_ERROR_KEY);
        expect(validationError.errors?.[0]?.field).toBe('name');
        expect(typeof validationError.errors?.[0]?.message).toBe('string');
      }
    });

    it('uses the provided error key when validation fails', () => {
      try {
        parseWithSchema(schema, { name: 123 }, 'errors:validation.invalidPagination');
        expect.fail('expected ValidationError');
      } catch (error) {
        expect((error as ValidationError).messageKey).toBe('errors:validation.invalidPagination');
      }
    });

    it('exposes the default error key constant', () => {
      expect(DEFAULT_INVALID_INPUT_ERROR_KEY).toBe('errors:invalidInput');
    });
  });
});
