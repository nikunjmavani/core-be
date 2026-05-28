import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import type { AuditService } from './audit.service.js';
import { AuditSerializer } from './audit.serializer.js';

/**
 * HTTP handlers for the admin audit-log routes. Thin layer that delegates to
 * {@link AuditService.list} and applies cursor-pagination response shaping.
 */
export function createAuditController(service: AuditService) {
  return {
    listLogs: async (request: FastifyRequest, _reply: FastifyReply) => {
      const result = await service.list(request.query as Record<string, unknown>);
      return paginatedResponse(AuditSerializer.many(result.items), getRequestIdentifier(request), {
        per_page: result.limit,
        next: result.next_cursor,
        has_more: result.has_more,
        ...(result.total !== null ? { estimated_total: result.total } : {}),
      });
    },
  };
}
