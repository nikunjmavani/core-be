import type { ResolvedListPagination } from '@/shared/utils/http/pagination.util.js';

export function testListPagination(limit = 20): ResolvedListPagination {
  return { limit };
}
