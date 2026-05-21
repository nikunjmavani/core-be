import { ValidationError } from '@/shared/errors/index.js';
import { ListAuditLogsQueryDto, type ListAuditLogsQuery } from './audit.dto.js';

export function validateListAuditLogsQuery(query: unknown): ListAuditLogsQuery {
  const result = ListAuditLogsQueryDto.safeParse(query);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
