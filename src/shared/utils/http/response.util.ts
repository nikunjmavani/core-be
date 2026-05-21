/** Paddle-style: single resource. Include meta.request_id (e.g. request.id). */
export function successResponse<T>(data: T, request_id: string) {
  return {
    data,
    meta: { request_id },
  };
}

/** Paddle-style: list with pagination. next_url optional (cursor or page-based). */
export function paginatedResponse<T>(
  data: T[],
  request_id: string,
  pagination: {
    per_page: number;
    next: string | null;
    has_more: boolean;
    estimated_total?: number;
  },
) {
  return {
    data,
    meta: {
      request_id,
      pagination,
    },
  };
}
