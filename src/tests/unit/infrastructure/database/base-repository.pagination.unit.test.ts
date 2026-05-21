import { describe, it, expect } from 'vitest';
import { BaseRepository } from '@/infrastructure/database/base-repository.js';

class TestRepository extends BaseRepository {
  paginatePublic<T>(items: T[], total: number, page: number, limit: number) {
    return this.paginate(items, total, page, limit);
  }

  cursorPaginatePublic<T>(items: T[], limit: number, cursorExtractor: (item: T) => string) {
    return this.cursorPaginate(items, limit, cursorExtractor);
  }
}

describe('BaseRepository pagination helpers', () => {
  const repository = new TestRepository();

  describe('paginate (offset)', () => {
    it('returns 0 total_pages when total is 0', () => {
      const result = repository.paginatePublic([], 0, 1, 25);
      expect(result.total_pages).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('computes total_pages without off-by-one', () => {
      expect(repository.paginatePublic([], 25, 1, 25).total_pages).toBe(1);
      expect(repository.paginatePublic([], 26, 1, 25).total_pages).toBe(2);
      expect(repository.paginatePublic([], 50, 1, 25).total_pages).toBe(2);
      expect(repository.paginatePublic([], 51, 1, 25).total_pages).toBe(3);
    });
  });

  describe('cursorPaginate', () => {
    it('returns null cursor when there are no items', () => {
      const result = repository.cursorPaginatePublic<{ id: string }>([], 10, (item) => item.id);
      expect(result.items).toHaveLength(0);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('returns next cursor as last item id when there are more rows', () => {
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const result = repository.cursorPaginatePublic(items, 2, (item) => item.id);
      expect(result.items).toHaveLength(2);
      expect(result.has_more).toBe(true);
      expect(result.next_cursor).toBe('b');
    });

    it('returns null cursor at end of results', () => {
      const items = [{ id: 'a' }, { id: 'b' }];
      const result = repository.cursorPaginatePublic(items, 2, (item) => item.id);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });
  });
});
