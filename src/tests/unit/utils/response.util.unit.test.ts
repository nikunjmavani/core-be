import { describe, expect, it } from 'vitest';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';

describe('response.util', () => {
  describe('successResponse', () => {
    it('wraps data with meta.request_id', () => {
      const response = successResponse({ id: '1' }, 'req-abc');
      expect(response).toEqual({
        data: { id: '1' },
        meta: { request_id: 'req-abc' },
      });
    });
  });

  describe('paginatedResponse', () => {
    it('wraps list data with pagination meta', () => {
      const response = paginatedResponse([{ id: 'a' }], 'req-xyz', {
        per_page: 20,
        next: '/api/v1/items?after=cursor',
        has_more: true,
        estimated_total: 100,
      });
      expect(response.data).toEqual([{ id: 'a' }]);
      expect(response.meta.request_id).toBe('req-xyz');
      expect(response.meta.pagination).toEqual({
        per_page: 20,
        next: '/api/v1/items?after=cursor',
        has_more: true,
        estimated_total: 100,
      });
    });

    it('omits estimated_total when not provided', () => {
      const response = paginatedResponse([], 'req-1', {
        per_page: 10,
        next: null,
        has_more: false,
      });
      expect(response.meta.pagination.estimated_total).toBeUndefined();
    });
  });
});
