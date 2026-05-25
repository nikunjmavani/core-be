import { describe, expect, it } from 'vitest';
import { PAGINATION } from '@/shared/constants/index.js';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';

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
});
