import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
import { ListAuditLogsQueryDto, type ListAuditLogsQuery } from './audit.dto.js';

/**
 * Validates the parsed query for `GET /api/v1/audit/logs` against
 * {@link ListAuditLogsQueryDto} after rejecting offset-style pagination.
 * Throws a `ValidationError` with field errors on bad input.
 */
export function validateListAuditLogsQuery(query: unknown): ListAuditLogsQuery {
  return parseCursorPaginatedQuery(ListAuditLogsQueryDto, query);
}
