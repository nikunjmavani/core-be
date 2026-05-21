import { ValidationError } from '@/shared/errors/index.js';
import { listNotificationsQueryDto, type ListNotificationsQueryInput } from './notification.dto.js';

export function validateListNotificationsQuery(query: unknown): ListNotificationsQueryInput {
  const result = listNotificationsQueryDto.safeParse(query);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
