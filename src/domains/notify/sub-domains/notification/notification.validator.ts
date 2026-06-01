import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import { listNotificationsQueryDto, type ListNotificationsQueryInput } from './notification.dto.js';

/**
 * Reject legacy `page`/`per_page` callers, then parse the `GET /notifications` query string with
 * {@link listNotificationsQueryDto}; throws `ValidationError('errors:invalidInput')` on failure.
 */
export function validateListNotificationsQuery(query: unknown): ListNotificationsQueryInput {
  ensureCursorOnlyPagination(query);
  const result = listNotificationsQueryDto.safeParse(query);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
