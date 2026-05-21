export interface CursorPaginatedResult<T> {
  items: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export abstract class BaseRepository {
  /**
   * Offset-based pagination helper.
   */
  protected paginate<T>(items: T[], total: number, page: number, limit: number) {
    return {
      items,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  /**
   * Cursor-based pagination helper.
   * Expects items to be fetched with limit + 1 to detect has_more.
   * The cursor is the last item's ID (or any sortable unique field).
   *
   * @param items - Items fetched with limit + 1
   * @param limit - Requested page size
   * @param cursorExtractor - Function to extract cursor value from an item
   */
  protected cursorPaginate<T>(
    items: T[],
    limit: number,
    cursorExtractor: (item: T) => string,
  ): CursorPaginatedResult<T> {
    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor =
      hasMore && pageItems.length > 0 ? cursorExtractor(pageItems[pageItems.length - 1]!) : null;

    return {
      items: pageItems,
      has_more: hasMore,
      next_cursor: nextCursor,
    };
  }
}
