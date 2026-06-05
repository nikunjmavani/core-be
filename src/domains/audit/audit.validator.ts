import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import { ListAuditLogsQueryDto, type ListAuditLogsQuery } from './audit.dto.js';

/**
 * Validates the parsed query for `GET /api/v1/audit/logs` against
 * {@link ListAuditLogsQueryDto} after rejecting offset-style pagination.
 * Throws a {@link ValidationError} with field errors on bad input.
 */
export function validateListAuditLogsQuery(query: unknown): ListAuditLogsQuery {
  ensureCursorOnlyPagination(query);
  const result = ListAuditLogsQueryDto.safeParse(query);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
