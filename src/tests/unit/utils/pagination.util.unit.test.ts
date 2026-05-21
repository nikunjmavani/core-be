import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OFFSET_PAGINATION_SUNSET } from '@/shared/constants/pagination.constants.js';
import { PAGINATION } from '@/shared/constants/index.js';
import { formatHttpDate } from '@/shared/utils/http/api-versioning.util.js';
import {
  cursorPaginationSchema,
  paginationSchema,
  resolveListPaginationQuery,
} from '@/shared/utils/http/pagination.util.js';

describe('pagination.util', () => {
  describe('paginationSchema', () => {
    it('applies defaults when query is empty', () => {
      const result = paginationSchema.parse({});
      expect(result.page).toBe(PAGINATION.DEFAULT_PAGE);
      expect(result.limit).toBe(PAGINATION.DEFAULT_LIMIT);
    });

    it('coerces string page and limit', () => {
      const result = paginationSchema.parse({ page: '2', limit: '50' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(50);
    });

    it('rejects limit above MAX_LIMIT', () => {
      expect(() => paginationSchema.parse({ limit: PAGINATION.MAX_LIMIT + 1 })).toThrow();
    });

    it('rejects page below 1', () => {
      expect(() => paginationSchema.parse({ page: 0 })).toThrow();
    });
  });

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

  describe('resolveListPaginationQuery', () => {
    it('sets Sunset and Deprecation when legacy page is present before sunset', () => {
      const header = vi.fn();
      const reply = { header } as unknown as FastifyReply;

      const result = resolveListPaginationQuery({ page: 2, limit: 10 }, reply);

      expect(result.offsetPage).toBe(2);
      expect(result.limit).toBe(10);
      expect(header).toHaveBeenCalledWith('Sunset', formatHttpDate(OFFSET_PAGINATION_SUNSET));
      expect(header).toHaveBeenCalledWith('Deprecation', 'true');
    });

    it('does not set deprecation headers when only after cursor is used', () => {
      const header = vi.fn();
      const reply = { header } as unknown as FastifyReply;

      resolveListPaginationQuery({ after: 'cursor-abc', limit: 10 }, reply);

      expect(header).not.toHaveBeenCalled();
    });
  });
});
