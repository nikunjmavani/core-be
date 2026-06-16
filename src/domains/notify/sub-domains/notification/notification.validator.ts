import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
import { listNotificationsQueryDto, type ListNotificationsQueryInput } from './notification.dto.js';

/**
 * Reject legacy `page`/`per_page` callers, then parse the `GET /notifications` query string with
 * {@link listNotificationsQueryDto}; throws `ValidationError('errors:invalidInput')` on failure.
 */
export function validateListNotificationsQuery(query: unknown): ListNotificationsQueryInput {
  return parseCursorPaginatedQuery(listNotificationsQueryDto, query);
}
