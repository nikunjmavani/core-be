import { describe, it, expect } from 'vitest';
import { BaseRepository } from '@/infrastructure/database/base-repository.js';

class TestRepository extends BaseRepository {
  cursorPaginatePublic<T>(items: T[], limit: number, cursorExtractor: (item: T) => string) {
    return this.cursorPaginate(items, limit, cursorExtractor);
  }
}

describe('BaseRepository pagination helpers', () => {
  const repository = new TestRepository();

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
