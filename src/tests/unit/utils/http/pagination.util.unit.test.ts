import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PAGINATION } from '@/shared/constants/index.js';
import { ValidationError } from '@/shared/errors/index.js';
import {
  cursorPaginationSchema,
  ensureCursorOnlyPagination,
  LEGACY_PAGE_NOT_SUPPORTED_MESSAGE,
  LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY,
  parseCursorPaginatedQuery,
  rejectLegacyPagePagination,
} from '@/shared/utils/http/pagination.util.js';

describe('pagination.util', () => {
  describe('cursorPaginationSchema', () => {
    it('applies default limit and optional after cursor', () => {
      const result = cursorPaginationSchema.parse({});
      expect(result.limit).toBe(PAGINATION.DEFAULT_LIMIT);
      expect(result.after).toBeUndefined();
    });

    it('accepts after cursor string', () => {
      const result = cursorPaginationSchema.parse({ after: 'cursor-abc', limit: '10' });
      expect(result.after).toBe('cursor-abc');
      expect(result.limit).toBe(10);
    });

    it('rejects limit above MAX_LIMIT', () => {
      expect(() => cursorPaginationSchema.parse({ limit: PAGINATION.MAX_LIMIT + 1 })).toThrow();
    });
  });

  describe('ensureCursorOnlyPagination', () => {
    it('does nothing for queries without the legacy page key', () => {
      expect(() => ensureCursorOnlyPagination({})).not.toThrow();
      expect(() => ensureCursorOnlyPagination({ limit: '25', after: 'opaque' })).not.toThrow();
      expect(() => ensureCursorOnlyPagination(undefined)).not.toThrow();
      expect(() => ensureCursorOnlyPagination(null)).not.toThrow();
    });

    it('throws a 400 ValidationError with the cursor-only message when page is present', () => {
      try {
        ensureCursorOnlyPagination({ page: '1', limit: '10' });
        expect.fail('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.statusCode).toBe(400);
        expect(validationError.messageKey).toBe(LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY);
        expect(validationError.message).toBe(LEGACY_PAGE_NOT_SUPPORTED_MESSAGE);
        expect(validationError.errors).toEqual([
          {
            field: 'page',
            messageKey: LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY,
            message: LEGACY_PAGE_NOT_SUPPORTED_MESSAGE,
          },
        ]);
      }
    });

    it('rejects page even when its value is undefined or null', () => {
      expect(() => ensureCursorOnlyPagination({ page: undefined })).toThrow(ValidationError);
      expect(() => ensureCursorOnlyPagination({ page: null })).toThrow(ValidationError);
    });

    it('ignores arrays and primitives', () => {
      expect(() => ensureCursorOnlyPagination(['page'])).not.toThrow();
      expect(() => ensureCursorOnlyPagination('page')).not.toThrow();
      expect(() => ensureCursorOnlyPagination(42)).not.toThrow();
    });

    it('supports Fastify pre-validation hooks', async () => {
      await expect(rejectLegacyPagePagination({ query: { limit: '10' } })).resolves.toBeUndefined();
      await expect(
        rejectLegacyPagePagination({ query: { page: '1', limit: '10' } }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('parseCursorPaginatedQuery', () => {
    it('parses the query with the schema when no legacy page param is present', () => {
      expect(parseCursorPaginatedQuery(cursorPaginationSchema, { limit: '10' })).toEqual({
        limit: 10,
      });
    });

    it('rejects legacy page pagination before the schema runs', () => {
      try {
        parseCursorPaginatedQuery(cursorPaginationSchema, { page: '1' });
        expect.fail('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).messageKey).toBe(LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY);
      }
    });

    it('applies the provided error key to schema failures', () => {
      const strict = z.object({ name: z.string() });
      try {
        parseCursorPaginatedQuery(strict, {}, 'errors:validation.invalidPagination');
        expect.fail('expected ValidationError');
      } catch (error) {
        expect((error as ValidationError).messageKey).toBe('errors:validation.invalidPagination');
      }
    });
  });
});
